import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { Resource } from "sst";
import { expo } from "@better-auth/expo";
import * as schema from "../db/schema";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: schema,
    }),
    trustedOrigins: [
        "projectmasjidmobile://",
        "exp://",
        "exp://**",
    ],
    baseURL: Resource.Api.url,
    socialProviders: {
        google: {
            clientId: Resource.GoogleClientId.value,
            clientSecret: Resource.GoogleClientSecret.value,
        },
    },
    plugins: [expo()]
});