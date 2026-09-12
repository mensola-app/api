import cors from "cors";
import express, { Request, Response } from "express";

import v1Routes from "@/routes/v1";
import shortLinkRoutes from "@/routes/v1/shortLink.routes";
import { redirectShortLink } from "@/controllers/v1/shortLink.controller";

import { globalErrorHandler } from "@/middlewares/error.middleware";
import { i18nMiddleware } from "@/middlewares/i18n.middleware";

const app = express();

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
app.use(i18nMiddleware);

app.use("/short-links", shortLinkRoutes);
app.use("/api/short-links", shortLinkRoutes);
app.use("/v1", v1Routes);

// Direct short link 302 redirection (5-8 unambiguous characters)
app.get(/^\/([1-9a-zA-HJ-NP-Za-km-z]{5,8})$/, redirectShortLink);

app.use(globalErrorHandler);

app.get("/", (req: Request, res: Response) => {
    res.send("Server is running successfully");
});

export default app;
