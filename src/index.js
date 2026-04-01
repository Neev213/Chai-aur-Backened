// require('dotenv').config({path: './path'})

import dotenv from "dotenv"

//import mongoose from "mongoose";
//import { DB_NAME} from "./constants";
import connectDB from "./db/index.js";

dotenv.config({
    path: './.env'
})


connectDB()














/*  First approach
import express from "express"
const app = express()

(async () => {
    try{
        await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`)
        app.on("errror", (error) => {
            console.log("ERROR: ", error);
            throw error
        })

        app.listen(process.env.PORT, () => {
            console.log(`App is listening on port ${process.env.PORT}`);
        })
    }catch(error){
        console.error("ERROR: ", error)
        throw err
    }
})()

*/