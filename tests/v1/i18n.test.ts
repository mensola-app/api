import { Request, Response } from "express";
import { z } from "zod";
import { parseAcceptLanguage, i18nMiddleware } from "@/middlewares/i18n.middleware";
import { MESSAGES, getMessages, translateMessage } from "@/constants/messages";
import { sendResponse } from "@/utils/response";
import { globalErrorHandler } from "@/middlewares/error.middleware";
import { validate } from "@/middlewares/validate.middleware";

describe("i18n Infrastructure Tests", () => {
    describe("parseAcceptLanguage", () => {
        it("should return 'tr' by default when header is missing or empty", () => {
            expect(parseAcceptLanguage(undefined)).toBe("tr");
            expect(parseAcceptLanguage("")).toBe("tr");
        });

        it("should return 'tr' when Turkish is requested", () => {
            expect(parseAcceptLanguage("tr")).toBe("tr");
            expect(parseAcceptLanguage("tr-TR,tr;q=0.9")).toBe("tr");
        });

        it("should return 'en' when English is requested", () => {
            expect(parseAcceptLanguage("en")).toBe("en");
            expect(parseAcceptLanguage("en-US,en;q=0.9")).toBe("en");
        });

        it("should prioritize higher quality values", () => {
            expect(parseAcceptLanguage("tr;q=0.5,en;q=0.9")).toBe("en");
            expect(parseAcceptLanguage("en;q=0.3,tr;q=0.8")).toBe("tr");
        });
    });

    describe("translateMessage & getMessages", () => {
        it("should return Turkish messages when language is 'tr'", () => {
            const msgs = getMessages("tr");
            expect(msgs.SUCCESS.LOGIN_SUCCESS).toBe("Giriş başarılı.");
            expect(translateMessage(MESSAGES.SUCCESS.LOGIN_SUCCESS, "tr")).toBe("Giriş başarılı.");
        });

        it("should return English messages when language is 'en'", () => {
            const msgs = getMessages("en");
            expect(msgs.SUCCESS.LOGIN_SUCCESS).toBe("Login successful.");
            expect(translateMessage(MESSAGES.SUCCESS.LOGIN_SUCCESS, "en")).toBe("Login successful.");
            expect(translateMessage(MESSAGES.ERRORS.UNAUTHORIZED, "en")).toBe("Access denied. Please log in.");
            expect(translateMessage(MESSAGES.ERRORS.INTERNAL_SERVER_ERROR, "en")).toBe(
                "An unexpected error occurred on the server.",
            );
        });

        it("should translate dynamic pattern messages to English", () => {
            const dynamicMsg = "Kullanıcı adınızı 14 günde bir değiştirebilirsiniz. Kalan gün: 5";
            expect(translateMessage(dynamicMsg, "en")).toBe(
                "You can change your username once every 14 days. Days remaining: 5",
            );
        });

        it("should translate OAuth account no password error message to English", () => {
            const trMsg = MESSAGES.ERRORS.OAUTH_ACCOUNT_NO_PASSWORD("Google");
            expect(trMsg).toBe(
                "Bu hesap Google ile oluşturulmuş. Lütfen Google ile giriş yapın veya bir şifre belirlemek için 'Şifremi Unuttum' adımını kullanın.",
            );
            expect(translateMessage(trMsg, "en")).toBe(
                "This account was created with Google. Please sign in with Google or reset your password to set one.",
            );
        });
    });

    describe("i18nMiddleware", () => {
        it("should attach language to req and res.locals", () => {
            const req = {
                headers: { "accept-language": "en-US,en;q=0.9" },
            } as unknown as Request;

            const res = {
                locals: {},
            } as unknown as Response;

            const next = jest.fn();

            i18nMiddleware(req, res, next);

            expect((req as any).language).toBe("en");
            expect(res.locals.language).toBe("en");
            expect(next).toHaveBeenCalledTimes(1);
        });
    });

    describe("sendResponse localization", () => {
        it("should translate response message when res.locals.language is 'en'", () => {
            const jsonMock = jest.fn();
            const statusMock = jest.fn().mockReturnValue({ json: jsonMock });

            const res = {
                locals: { language: "en" },
                status: statusMock,
            } as unknown as Response;

            sendResponse(res, 200, { foo: "bar" }, MESSAGES.SUCCESS.LOGIN_SUCCESS);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                message: "Login successful.",
                data: { foo: "bar" },
            });
        });

        it("should keep Turkish message when res.locals.language is 'tr'", () => {
            const jsonMock = jest.fn();
            const statusMock = jest.fn().mockReturnValue({ json: jsonMock });

            const res = {
                locals: { language: "tr" },
                status: statusMock,
            } as unknown as Response;

            sendResponse(res, 200, null, MESSAGES.SUCCESS.USER_FOLLOWED);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                message: "Kullanıcı takip edildi.",
                data: null,
            });
        });
    });

    describe("globalErrorHandler localization", () => {
        it("should translate error message to English when requested", () => {
            const jsonMock = jest.fn();
            const statusMock = jest.fn().mockReturnValue({ json: jsonMock });

            const req = { headers: {} } as unknown as Request;
            const res = {
                locals: { language: "en" },
                status: statusMock,
            } as unknown as Response;
            const next = jest.fn();

            const err = {
                statusCode: 401,
                message: MESSAGES.ERRORS.UNAUTHORIZED,
            };

            globalErrorHandler(err, req, res, next);

            expect(statusMock).toHaveBeenCalledWith(401);
            expect(jsonMock).toHaveBeenCalledWith({
                success: false,
                error: {
                    code: 401,
                    message: "Access denied. Please log in.",
                },
            });
        });
    });

    describe("validate middleware localization", () => {
        it("should translate validation messages to English when requested", () => {
            const schema = z.object({
                body: z.object({
                    email: z.string({ message: MESSAGES.ERRORS.FIELD_REQUIRED("E-posta") }),
                }),
            });

            const jsonMock = jest.fn();
            const statusMock = jest.fn().mockReturnValue({ json: jsonMock });

            const req = {
                body: {},
                query: {},
                params: {},
            } as unknown as Request;

            const res = {
                locals: { language: "en" },
                status: statusMock,
            } as unknown as Response;
            const next = jest.fn();

            const middleware = validate(schema);
            middleware(req, res, next);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({
                        code: 400,
                        message: "E-posta is required.",
                    }),
                }),
            );
        });
    });
});
