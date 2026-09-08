import { OAuth2Client } from "google-auth-library";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID was not found in the .env file.");
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface GoogleUserPayload {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
}

/**
 * Verifies a Google ID token and extracts user information from the payload.
 *
 * @param idToken - The Google ID token received from the client.
 * @returns The decoded user payload, or null if the token is invalid.
 */
export const verifyGoogleToken = async (idToken: string): Promise<GoogleUserPayload | null> => {
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.sub || !payload.email) {
            return null;
        }

        return {
            sub: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
        };
    } catch {
        return null;
    }
};
