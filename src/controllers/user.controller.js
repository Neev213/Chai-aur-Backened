import { asyncHandler } from "../utils/asyncHandler.js"; // Imports an async-wrapper to catch errors and pass them to Express
import { ApiError } from "../utils/apiError.js"; // Imports the custom ApiError class for standardized error responses
import { User } from "../models/user.model.js"; // Imports the Mongoose User model for database operations
import { uploadOnCloudinary } from "../utils/cloudinary.js"; // Imports a helper to upload local files to Cloudinary
import { ApiResponse } from "../utils/ApiResponse.js"; // Imports a custom ApiResponse class for standardized success responses
import jwt from "jsonwebtoken"; // Imports jsonwebtoken library to verify/issue JWT tokens
import mongoose from "mongoose"; // Imports mongoose for MongoDB types (e.g., ObjectId in aggregations)

const generateAccessAndRefreshTokens = async (userId) => { // Helper function that creates access + refresh tokens for a user
  try {
    const user = await User.findById(userId); // Fetches the user document by its MongoDB id
    const accessToken = user.generateAccessToken(); // Uses the User model method to generate a short-lived access token
    const refreshToken = user.generateRefreshToken(); // Uses the User model method to generate a long-lived refresh token

    user.refreshToken = refreshToken; // Stores the newly generated refresh token in the user document
    await user.save({ validateBeforeSave: false }); // Saves user without running schema validation again

    return { accessToken, refreshToken }; // Returns both tokens to the caller
  } catch (error) {
    throw new ApiError(
      500,
      "something went wrong while generating access and refresh Token"
    ); // Throws a standardized server error if token generation fails
  }
};

const registerUser = asyncHandler(async (req, res) => { // Route controller to handle user registration
  console.log("BODY:", req.body); // Logs parsed form fields from the request body
  console.log("FILES:", req.files); // Logs uploaded files handled by multer

  const avatarLocalPath = req.files?.avatar?.[0]?.path; // Reads the temporary local path of the uploaded avatar
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path; // Reads the temporary local path of the uploaded cover image

  const { fullname, email, username, password } = req.body; // Destructures required fields from request body

  if ([fullname, email, username, password].some((field) => field?.trim() === "")) {
    // Checks whether any required field is missing/empty after trimming spaces
    throw new ApiError(400, "All fields are required"); // Throws 400 if any field is invalid
  }

  const existedUser = await User.findOne({
    // Searches for an existing user with either same username or same email
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    // If a user already exists, prevent duplicate registration
    throw new ApiError(409, "User already exists"); // Throws 409 conflict
  }

  console.log(req.files); // Debug log for uploaded files

  /* let coverImageLocalPath;

  if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
      coverImageLocalPath = req.files.coverImage[0].path
  }
  */ // (Commented old code) shows an alternative way to extract cover image path

  if (!avatarLocalPath) {
    // If avatar file was not provided
    throw new ApiError(400, "Avatar file is required"); // Throws 400
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath); // Uploads avatar to Cloudinary and returns upload response (or null)
  const coverImage = await uploadOnCloudinary(coverImageLocalPath); // Uploads cover image to Cloudinary

  if (!avatar) {
    // If avatar upload failed
    throw new ApiError(400, "Avatar upload failed"); // Throws 400
  }

  const user = await User.create({
    // Creates the new user document in MongoDB
    fullname,
    avatar: avatar.url, // Stores Cloudinary URL for avatar
    coverImage: coverImage?.url || "", // Stores Cloudinary URL for cover image (or empty string)
    email,
    password, // Password will be hashed by the User model pre-save hook
    username: username.toLowerCase(), // Normalizes username to lowercase
  });

  const createdUser = await User.findById(user._id).select(
    // Re-fetches the user but excludes sensitive fields
    "-password -refreshToken"
  );

  if (!createdUser) {
    // If user could not be fetched
    throw new ApiError(500, "User creation failed"); // Throws server error
  }

  return res.status(201).json(
    // Returns HTTP 201 (Created) with standardized response body
    new ApiResponse(200, createdUser, "User registered successfully")
  );
});
const loginUser = asyncHandler(async (req, res) => { // Controller to authenticate a user and issue JWT cookies
    // req.body contains login fields (email/username/password)

    const { email, username, password } = req.body // Destructure email, username, password from request body
    console.log(email); // Debug log: prints the provided email

    if (!email && !username) { // If neither email nor username is provided
        throw new ApiError(400, "Email or username is required") // Return HTTP 400 with an error
    }

    const user = await User.findOne({
        // Search for a user document where username matches OR email matches
        $or: [{ username }, { email }]
    }).select("+password") // Include password field (normally excluded) for password verification

    if (!user) { // If no user matches the query
        throw new ApiError(404, "User not found") // Return HTTP 404
    }

    const isPasswordValid = await user.isPasswordCorrect(password) // Compare provided password with hashed password in DB

    console.log("Entered:", password) // Debug log: provided password (plain)
    console.log("Stored:", user.password) // Debug log: stored hashed password

    if (!isPasswordValid) { // If password comparison fails
        throw new ApiError(401, "password incorrect") // Return HTTP 401
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id) // Issue access & refresh tokens and store refresh token on user

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken") // Fetch user again without sensitive fields

    const options = {
        httpOnly: true, // Cookies cannot be accessed by client-side JS (helps prevent XSS)
        secure: true // Cookies are only sent over HTTPS
    }

    return res.status(200).cookie("accessToken", accessToken, options) // Set accessToken cookie
    .cookie("refreshToken", refreshToken, options) // Set refreshToken cookie
    .json(
        new ApiResponse(
            200, // success status code
            {
                user: loggedInUser, // return public user data
                accessToken, // include access token in response body
                refreshToken // include refresh token in response body
            },
            "User Logged In SuccessFully" // success message
        )
    )

})

const logoutUser = asyncHandler(async (req, res) => { // Clears refresh token and client cookies to log user out
    await User.findByIdAndUpdate( // Updates the user document by id
        req.user._id, // Uses authenticated user id from req.user (set by verifyJWT)
        {
            $unset: {
                refreshToken: 1 // Removes refreshToken field so it can’t be used again
            }
        },
        {
            new: true // Option that returns updated document (though result isn’t used here)
        }
    )

    const options = { // Cookie options for secure HTTP-only cookies
        httpOnly: true, // Prevents JS access to cookies (helps mitigate XSS)
        secure: true // Ensures cookie is sent only over HTTPS
    }
    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options) // Clears both cookies on client
    .json(new ApiResponse(200, {}, "User Logged Out")) // Sends standardized API response
})

const refreshAccessToken = asyncHandler(async (req, res) => { // Issues new access/refresh tokens using refresh token
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken // Reads refresh token from cookie or body

    if (!incomingRefreshToken) { // If no refresh token was provided
        throw new ApiError(401, "Unauthorized request") // Respond with unauthorized
    }

    try {
        const decodedToken = jwt.verify( // Verifies refresh token signature + expiry
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET // Secret used to verify refresh tokens
        )

        const user = await User.findById(decodedToken?._id) // Finds the user associated with decoded token id

        if (!user) { // If user doesn’t exist
            throw new ApiError(401, "Invalid refresh Token") // Unauthorized
        }

        if (incomingRefreshToken !== user?.refreshToken) { // Ensures provided refresh token matches token stored in DB
            throw new ApiError(401, "Refresh Token is expired Or used") // Token reuse/rotation invalid
        }

        const options = { // Cookie options
            httpOnly: true,
            secure: true
        }

        const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id) // Generates new tokens and updates refreshToken on user

        return res
            .status(200) // Sets HTTP 200
            .cookie("accessToken", accessToken, options) // Stores new access token in cookie
            .cookie("refreshToken", refreshToken, options) // Stores new refresh token in cookie
            .json(
                new ApiResponse(
                    200,
                    { accessToken, refreshToken: newRefreshToken }, // (Note: existing variable name issue remains; logic unchanged)
                    "Access Token refreshed"
                )
            )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid Refresh Token") // Handles invalid/expired tokens
    }
})
    const changeCurrentPassword = asyncHandler(async (req, res) => { // Allows logged-in user to change password
        const { oldPassword, newPassword } = req.body // Reads old and new passwords from request body

        const user = await User.findById(req.user?._id) // Fetches current user from DB using authenticated id
        const isPasswordCorrect = await user.isPasswordCorrect(oldPassword) // Compares provided old password with stored hashed password

        if (!isPasswordCorrect) { // If old password doesn’t match
            throw new ApiError(400, "Invalid old password") // Reject request
        }

        user.password = newPassword // Sets new password (User schema pre-save will hash it)

        await user.save({ validateBeforeSave: false }) // Saves without rerunning validation rules

        return res.status(200)
        .json(new ApiResponse(200, {}, "Password Changed Successfully")) // Sends success response
    })

    const getCurrentUser = asyncHandler(async(req, res) => {
        return res
        .status(200)
        .json(200, req.user, "Current user fetched successfully")
    })

    const updateAccountDetails = asyncHandler(async(req, res) => {
        const {fullname, email} = req.body

        if(!fullname || !email){
            throw new ApiError(400, "All fields are required")
        }

        const user = await User.findByIdAndUpdate(
            req.user?._id,
            {
                $set: {
                    fullname, 
                    email
                }
            },
            {new: true}


        ).select("-password")

        return res.status(200)
        .json(new ApiResponse(200, user, "Account detail updated successfully"))

    })

    const updateUserAvatar = asyncHandler(async(req, res) => {
        const avatarLocalPath = req.file?.path

        if(!avatarLocalPath){
            throw new ApiError(400, "Avatar file is required")

        }

        const avatar = await uploadOnCloudinary(avatarLocalPath)

        if(!avatar.url){
            throw new ApiError(400, "Avatar upload failed")
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            {
                $set: {
                    avatar: avatar.url
                }
            },
            {new:true}
        ). select("-password")

        return res
        .status(200)
        .json(
            new ApiResponse(200, user, "Avatar updated successfully")
        )

    })


    const updateUserCoverImage = asyncHandler(async(req, res) => {
        const coverImageLocalPath = req.file?.path

        if(!coverImageLocalPath){
            throw new ApiError(400, "CoverImage file is required")

        }

        const coverImage = await uploadOnCloudinary(coverImageLocalPath)

        if(!coverImage.url){
            throw new ApiError(400, "CoverImage upload failed")
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            {
                $set: {
                    coverImage: coverImage.url
                }
            },
            {new:true}
        ). select("-password")

        return res
        .status(200)
        .json(
            new ApiResponse(200, user, "Cover image updated successfully")
        )

    })

    const getUserChannelProfile = asyncHandler(async(req, res) => {
        const {username} = req.params

        if(!username?.trim()){
            throw new ApiError(400, "Username is missing")
        }

        const channel = await User.aggregate([  // pipelines 
            {
                $match: {
                    username: username?.toLowerCase()
                }
            },
            {
                $lookup: {
                    from: "subscriptions",
                    localField: "_id",
                    foreignField: "channel",
                    as: "subscribers"
                }
            },
            {
                $lookup: {
                    from: "subscriptions",
                    localField: "_id",
                    foreignField: "subscriber",
                    as: "subscribedTo"
                }
            },
            {
                $addFields: {
                    subscibersCount: {
                        $size: "$subscribers"

                    },
                    channelSubscribedToCount: {
                        $size: "$subscribedTo"
                    },
                    isSubscribed:{
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
                }
            },
            {
                $project: {
                    fullname: 1,
                    username: 1,
                    subscibersCount: 1,
                    channelSubscribedToCount: 1,
                    isSubscribed: 1,
                    avatar: 1,
                    coverImage: 1,
                    email: 1


                }
            }
        
        ])

        if(!channel?.length){
            throw new ApiError(404, "Channel does not exists")
        }

        return res
        .status(200)
        .json(
            new ApiResponse(200, channel[0], "User channel fetched successfully")
        )

    })

    const getWatchHistory = asyncHandler(async(req, res) => {

        const user = await User.aggregate([
            {$match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }},
            {
                $lookup: {
                    from: "videos",
                    localField: "WatchHistory",
                    foreignField: "_id",
                    as: "watchHistory",
                    pipeline: [
                        {
                            $lookup: {
                                from: "user",
                                localField: "owner",
                                foreignField: " _id",
                                as: "owner",
                                pipeline: [
                                    {
                                        $project: {
                                            fullname: 1,
                                            username: 1,
                                            avatar: 1
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            $addFields: {
                                owner: {
                                    $first: "$owner"
                                }
                            }
                        }
                    ]
                }
            }
        ])

        return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                user[0].watchHistory,
                "Watch History fetched successfully"
            )
        )
    })


export { registerUser, loginUser, logoutUser, refreshAccessToken, changeCurrentPassword, getCurrentUser, updateAccountDetails,
    updateUserAvatar, updateUserCoverImage, getUserChannelProfile, getWatchHistory
}