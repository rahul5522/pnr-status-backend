import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import cors from "cors";

import pnrRoutes from "./routes/pnrRoutes.js";

const app = express();

//Adding common midllewares
app.use(morgan('dev'));
app.use(cors());
app.options("*", cors());
app.use(express.json());

//Routing
app.use("/pnr", pnrRoutes);

export default app;
