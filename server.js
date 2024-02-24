import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT;

//Incase of DB connection

app.listen(port, () => {
    console.log(`Server Started on Port ${port}`);
});