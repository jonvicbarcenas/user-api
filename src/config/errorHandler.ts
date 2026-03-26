import type { ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { log } from "./logger.js";

const errResp: { status: ContentfulStatusCode; message: string } = {
    status: 500,
    message: "Internal Server Error",
};

export const errorHandler: ErrorHandler = (err, c) => {
    log.error(JSON.stringify(err));
    errResp.status = 500;
    errResp.message = err.message || "Internal Server Error";
    return c.json(errResp, errResp.status);
};

export const notFoundHandler: NotFoundHandler = (c) => {
    errResp.status = 404;
    errResp.message = "Not Found";
    log.error(JSON.stringify(errResp));
    return c.json(errResp, errResp.status);
};
