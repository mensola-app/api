import pool from "@/config/db";
import { commentQueries } from "@/queries/comment.queries";
import { ApiError } from "@/utils/error";
import { InteractionId } from "@/types/common.types";
import { createNotification, buildNotificationPushContent } from "./notification.service";
import {
    CommentThreadItem,
    CommentThreadPagination,
    CommentThreadResponse,
    CreateReplyDto,
    GetCommentThreadDto,
    ToggleCommentLikeDto,
    ToggleCommentLikeResponse,
} from "@/types/interaction.types";

/**
 * Resolves the interactionId associated with a given commentId.
 *
 * This is the first step in building the comment thread: we locate
 * the root interaction so that we can then fetch all sibling / child
 * comments that belong to the same interaction chain.
 *
 * @param commentId - The UUID of the comment used as the entry point.
 * @returns The interactionId of the resolved comment.
 * @throws {ApiError} 404 Not Found if no comment with the given id exists.
 */
const resolveInteractionId = async (commentId: string): Promise<InteractionId> => {
    const result = await pool.query<{ interactionId: InteractionId }>(
        commentQueries.findInteractionIdByCommentId,
        [commentId],
    );

    if (result.rowCount === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    return result.rows[0].interactionId;
};

/**
 * Fetches the full paginated comment thread for a given commentId.
 *
 * Workflow:
 *  1. Resolve the interactionId from the provided commentId.
 *  2. Count all comments tied to that interactionId (for pagination metadata).
 *  3. Fetch the paginated, chronologically ordered comment list with user info,
 *     likeCount and isLiked (based on currentUserId).
 *
 * The returned list is **flat** – parentId is included in each item so the
 * mobile client can handle any tree rendering it needs on its end.
 *
 * @param dto - DTO containing the entry commentId, page, limit, and optional currentUserId.
 * @returns A CommentThreadResponse with the flat comment list and pagination metadata.
 * @throws {ApiError} 404 Not Found if the commentId does not exist.
 */
export const getCommentThread = async (
    dto: GetCommentThreadDto,
): Promise<CommentThreadResponse> => {
    const { commentId, page, limit, currentUserId } = dto;
    const offset = (page - 1) * limit;

    // Step 1 – resolve the interactionId from the provided commentId
    const interactionId = await resolveInteractionId(commentId as string);

    // Step 2 – count all comments for this interaction (needed for pagination meta)
    const countResult = await pool.query<{ total: number }>(
        commentQueries.countCommentsByInteractionId,
        [interactionId],
    );
    const total = countResult.rows[0]?.total ?? 0;

    // Step 3 – fetch the paginated, ordered comment list with likeCount + isLiked
    const commentsResult = await pool.query<CommentThreadItem>(
        commentQueries.getCommentsByInteractionId,
        [interactionId, limit, offset, currentUserId ?? null],
    );

    const pagination: CommentThreadPagination = {
        total,
        page,
        limit,
        hasMore: offset + commentsResult.rows.length < total,
    };

    return {
        interactionId,
        comments: commentsResult.rows,
        pagination,
    };
};

/**
 * Toggles the like state of a comment for the requesting user.
 *
 * Idempotent toggle semantics:
 *  - If a CommentLike row already exists for (userId, commentId) → delete it (unlike).
 *  - Otherwise → insert a new row (like).
 *
 * Returns the fresh likeCount and the resulting isLiked state.
 *
 * @param dto - DTO containing the commentId and authenticated userId.
 * @returns ToggleCommentLikeResponse with isLiked and likeCount.
 * @throws {ApiError} 404 Not Found if the comment does not exist.
 */
export const toggleCommentLike = async (
    dto: ToggleCommentLikeDto,
): Promise<ToggleCommentLikeResponse> => {
    const { commentId, userId } = dto;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Guard: verify the comment exists before attempting any write
        const commentCheck = await client.query(commentQueries.checkCommentExists, [commentId]);
        if (commentCheck.rowCount === 0) {
            throw new ApiError("NOT_FOUND", 404);
        }

        // Check for an existing like
        const existing = await client.query(commentQueries.findCommentLike, [userId, commentId]);
        const isAlreadyLiked = (existing.rowCount ?? 0) > 0;

        let notificationToSend: Parameters<typeof createNotification>[0] | null = null;

        if (isAlreadyLiked) {
            // Unlike: remove the row
            await client.query(commentQueries.removeCommentLike, [userId, commentId]);

            // Clean up unread notification
            await client.query(
                `DELETE FROM "Notification"
                 WHERE "actorId" = $1 AND "type" = 'like' AND "targetType" = 'comment' AND "targetId" = $2 AND "isRead" = false`,
                [userId, commentId],
            );
        } else {
            // Like: insert a new row
            await client.query(commentQueries.addCommentLike, [userId, commentId]);

            // Fetch comment author
            const commentRes = await client.query<{ userId: string; content: string }>(
                `SELECT "userId", "content" FROM "Comment" WHERE id = $1`,
                [commentId],
            );
            const comment = commentRes.rows[0];
            if (comment && comment.userId !== userId) {
                const userRes = await client.query<{ username: string; fullname: string }>(
                    `SELECT username, fullname FROM "User" WHERE id = $1`,
                    [userId],
                );
                const liker = userRes.rows[0];
                const likerName = liker?.fullname || liker?.username;

                notificationToSend = {
                    recipientId: comment.userId,
                    actorId: userId,
                    type: "like",
                    targetType: "comment",
                    targetId: commentId,
                    resolvePushContent: (locale) =>
                        buildNotificationPushContent(
                            "like",
                            { actorName: likerName, targetType: "comment" },
                            locale,
                        ),
                    path: `/comments/${commentId}`,
                };
            }
        }

        // Fetch the fresh like count after the toggle
        const countResult = await client.query<{ likeCount: number }>(
            commentQueries.countCommentLikes,
            [commentId],
        );
        const likeCount = countResult.rows[0]?.likeCount ?? 0;

        await client.query("COMMIT");

        // Dispatch notification asynchronously after successful commit
        if (notificationToSend) {
            await createNotification(notificationToSend);
        }

        return {
            commentId,
            isLiked: !isAlreadyLiked,
            likeCount,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Like error in toggleCommentLike:", error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Creates a new reply to an existing comment within the same interaction thread.
 *
 * Workflow:
 *  1. Checks if the target parent comment exists in the database.
 *     If not found, throws 404 NOT_FOUND.
 *  2. Resolves the parent comment's interactionId to maintain the correct
 *     media/target relation (movie, track, playlist, album, etc.).
 *  3. In a transaction, inserts the new reply with parentId = commentId.
 *  4. Returns the newly created comment joined with User details (id, username, avatar)
 *     and default likeCount: 0, isLiked: false.
 *
 * @param dto - DTO containing commentId, userId, and sanitized content.
 * @returns The newly created CommentThreadItem.
 * @throws {ApiError} 404 Not Found if target comment doesn't exist.
 */
export const createReply = async (dto: CreateReplyDto): Promise<CommentThreadItem> => {
    const { commentId, userId, content } = dto;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Step 1: Verify target comment exists and get its interactionId
        const parentResult = await client.query<{ id: string; interactionId: InteractionId }>(
            commentQueries.findCommentWithInteraction,
            [commentId],
        );

        if (parentResult.rowCount === 0) {
            throw new ApiError("NOT_FOUND", 404);
        }

        const { interactionId } = parentResult.rows[0];

        // Step 2: Insert the reply within the same interaction chain and return with user details
        const insertResult = await client.query<CommentThreadItem>(
            commentQueries.createReply,
            [userId, interactionId, commentId, content],
        );

        await client.query("COMMIT");

        return insertResult.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

