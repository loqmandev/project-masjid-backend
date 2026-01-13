CREATE TYPE "public"."achievement_type" AS ENUM('explorer', 'prayer_warrior', 'streak', 'geographic', 'special');--> statement-breakpoint
CREATE TYPE "public"."badge_tier" AS ENUM('bronze', 'silver', 'gold', 'platinum', 'diamond');--> statement-breakpoint
CREATE TYPE "public"."check_in_status" AS ENUM('checked_in', 'completed', 'incomplete');--> statement-breakpoint
CREATE TABLE "achievement_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text NOT NULL,
	"description_en" text,
	"type" "achievement_type" NOT NULL,
	"badge_tier" "badge_tier" NOT NULL,
	"required_count" integer,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"icon_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_definition_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "check_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_profile_id" uuid NOT NULL,
	"masjid_id" text NOT NULL,
	"masjid_name" text NOT NULL,
	"check_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"check_in_lat" real NOT NULL,
	"check_in_lng" real NOT NULL,
	"check_out_at" timestamp with time zone,
	"check_out_lat" real,
	"check_out_lng" real,
	"status" "check_in_status" DEFAULT 'checked_in' NOT NULL,
	"base_points" integer DEFAULT 0 NOT NULL,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"actual_points_earned" integer DEFAULT 0 NOT NULL,
	"checkout_in_proximity" boolean,
	"duration_minutes" integer,
	"is_prayer_time" boolean DEFAULT false NOT NULL,
	"prayer_name" text,
	"is_first_visit_to_masjid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_masjid_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"masjid_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"visitor_count" integer DEFAULT 0 NOT NULL,
	"unique_visitor_count" integer DEFAULT 0 NOT NULL,
	"total_points_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_leaderboard_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"user_profile_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"total_points" integer NOT NULL,
	"masjids_visited" integer NOT NULL,
	"display_name" text NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_profile_id" uuid NOT NULL,
	"achievement_definition_id" uuid NOT NULL,
	"current_progress" integer DEFAULT 0 NOT NULL,
	"required_progress" integer NOT NULL,
	"progress_percentage" real DEFAULT 0 NOT NULL,
	"is_unlocked" boolean DEFAULT false NOT NULL,
	"unlocked_at" timestamp with time zone,
	"progress_metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"monthly_points" integer DEFAULT 0 NOT NULL,
	"unique_masjids_visited" integer DEFAULT 0 NOT NULL,
	"total_check_ins" integer DEFAULT 0 NOT NULL,
	"global_rank" integer,
	"monthly_rank" integer,
	"achievement_count" integer DEFAULT 0 NOT NULL,
	"show_full_name_in_leaderboard" boolean DEFAULT true NOT NULL,
	"leaderboard_alias" text,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_visit_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_user_profile_id_user_profile_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_leaderboard_snapshot" ADD CONSTRAINT "monthly_leaderboard_snapshot_user_profile_id_user_profile_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_user_profile_id_user_profile_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_achievement_definition_id_achievement_definition_id_fk" FOREIGN KEY ("achievement_definition_id") REFERENCES "public"."achievement_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_achievement_def_type" ON "achievement_definition" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_achievement_def_badge_tier" ON "achievement_definition" USING btree ("badge_tier");--> statement-breakpoint
CREATE INDEX "idx_achievement_def_sort_order" ON "achievement_definition" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_check_in_user" ON "check_in" USING btree ("user_profile_id");--> statement-breakpoint
CREATE INDEX "idx_check_in_masjid" ON "check_in" USING btree ("masjid_id");--> statement-breakpoint
CREATE INDEX "idx_check_in_status" ON "check_in" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_check_in_check_in_at" ON "check_in" USING btree ("check_in_at");--> statement-breakpoint
CREATE INDEX "idx_check_in_user_status" ON "check_in" USING btree ("user_profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_masjid_stats_unique" ON "daily_masjid_stats" USING btree ("masjid_id","date");--> statement-breakpoint
CREATE INDEX "idx_daily_masjid_stats_date" ON "daily_masjid_stats" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_daily_masjid_stats_masjid" ON "daily_masjid_stats" USING btree ("masjid_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_monthly_leaderboard_unique" ON "monthly_leaderboard_snapshot" USING btree ("month","user_profile_id");--> statement-breakpoint
CREATE INDEX "idx_monthly_leaderboard_month" ON "monthly_leaderboard_snapshot" USING btree ("month");--> statement-breakpoint
CREATE INDEX "idx_monthly_leaderboard_rank" ON "monthly_leaderboard_snapshot" USING btree ("month","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_achievement_unique" ON "user_achievement" USING btree ("user_profile_id","achievement_definition_id");--> statement-breakpoint
CREATE INDEX "idx_user_achievement_user" ON "user_achievement" USING btree ("user_profile_id");--> statement-breakpoint
CREATE INDEX "idx_user_achievement_unlocked" ON "user_achievement" USING btree ("is_unlocked");--> statement-breakpoint
CREATE INDEX "idx_user_profile_total_points" ON "user_profile" USING btree ("total_points");--> statement-breakpoint
CREATE INDEX "idx_user_profile_monthly_points" ON "user_profile" USING btree ("monthly_points");--> statement-breakpoint
CREATE INDEX "idx_user_profile_global_rank" ON "user_profile" USING btree ("global_rank");--> statement-breakpoint
CREATE INDEX "idx_user_profile_monthly_rank" ON "user_profile" USING btree ("monthly_rank");