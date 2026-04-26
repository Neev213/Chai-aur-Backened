import { Router } from "express";
import {loginUser, logoutUser, registerUser} from "../controllers/user.controller.js"
import { upload } from "../db/middleware/multer.middleware.js";
import { verifyJWT } from "../db/middleware/auth.middleware.js";



const router = Router()

router.route("/register").post(
    upload.fields([
        {
            name: "avatar",
            maxCount: 1
        },
        {
            name: "coverImage",
            maxCount: 1
        }
    ]),
    registerUser
)

router.route("/login").post(loginUser)

//secrured routes

router.route("/logout").post(verifyJWT, logoutUser)





export default router