/**
 * @module api/user
 * @description API route for user creation and retrieval.
 *
 * POST /api/user - Creates or returns existing user based on Clerk authentication.
 * Uses upsert pattern: creates user if not found, returns existing if already registered.
 *
 * @requires Authentication via Clerk
 */

import { db } from "@/config/db";
import { usersTable } from "@/config/schema";
import { apiError, apiSuccess } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const user = await currentUser();

        // Auth guard — validate Clerk session
        if (!user?.primaryEmailAddress?.emailAddress || !user?.fullName) {
            return apiError(
                "Authentication required. Please sign in.",
                401,
                "UNAUTHORIZED"
            );
        }

        const email = user.primaryEmailAddress.emailAddress;
        const name = user.fullName;

        // Check if user already exists
        const existingUsers = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.email, email));

        if (existingUsers.length > 0) {
            return apiSuccess(existingUsers[0]);
        }

        // Create new user
        const newUser = await db
            .insert(usersTable)
            .values({ email, name })
            .returning();

        return apiSuccess(newUser[0], 201);

    } catch (error: any) {
        console.error("❌ User API Error:", error.message);
        return apiError(
            "Failed to process user request",
            500,
            "INTERNAL_ERROR",
            error.message
        );
    }
}