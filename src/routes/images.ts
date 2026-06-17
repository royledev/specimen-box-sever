// POST /v1/images/draw（ADR-0004 §1 / ADR-0003）。

import { Hono } from "hono";
import type { Env, ImageRef, ImagesDrawResponse } from "../types";
import { imagesDrawSchema, validationErrorBody } from "../schema";
import { drawImage } from "../lib/images";
import {
  countImages,
  fetchImageByIdx,
  fetchImagesLinear,
} from "../lib/db/imagesRepo";
import { buildImageUrl } from "../lib/imageUrl";

export const imagesRoute = new Hono<{ Bindings: Env }>();

imagesRoute.post("/draw", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request", message: "body must be JSON" }, 400);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return c.json({ error: "invalid_request", message: "body must be a JSON object" }, 400);
  }

  const parsed = imagesDrawSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(validationErrorBody(c.env, parsed.error.issues), 400);
  }
  const body = parsed.data;

  const owned = new Set(body.owned);
  const N = await countImages(c.env.DB);

  const result = await drawImage(
    N,
    owned,
    (idx) => fetchImageByIdx(c.env.DB, idx),
    (startIdx, limit) => fetchImagesLinear(c.env.DB, startIdx, limit),
    Math.random,
  );

  if (result === null) {
    const res: ImagesDrawResponse = { image: null, exhausted: true };
    return c.json(res);
  }

  const { row } = result;
  const url = await buildImageUrl(row.r2_key, c.env);

  const image: ImageRef = {
    id: row.image_id,
    url,
    name: row.name,
    format: row.format,
    width: row.width,
    height: row.height,
    rarity: row.rarity,
  };
  if (row.bytes !== null) {
    image.bytes = row.bytes;
  }

  const res: ImagesDrawResponse = { image, exhausted: false };
  return c.json(res);
});
