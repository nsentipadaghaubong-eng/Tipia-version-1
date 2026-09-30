import Database from "@tauri-apps/plugin-sql";

export type SqliteDatabase = Awaited<ReturnType<typeof Database.load>>;

export const loadDatabase = async (): Promise<SqliteDatabase> =>
    Database.load("sqlite:tipia.db");
