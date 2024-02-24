import express from "express";

import { getPnrStatus, subscribePnr, stopSubscriber } from "../controllers/pnrController.js";

const router = express.Router();

router.get("/", getPnrStatus);

router.post("/subscribe", subscribePnr);

router.post("/unsubscribe", stopSubscriber);

export default router;
