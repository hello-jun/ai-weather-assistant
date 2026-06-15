import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// 确保数据目录存在
const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, "messages.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    thread_id  TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    message    TEXT NOT NULL,
    PRIMARY KEY (thread_id, seq)
  )
`);

interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export function saveMessage(threadId: string, message: StoredMessage): void {
  const seq = getNextSeq(threadId);
  const stmt = db.prepare(
    "INSERT INTO messages (thread_id, seq, message) VALUES (?, ?, ?)"
  );
  stmt.run(threadId, seq, JSON.stringify(message));
}

export function saveMessages(threadId: string, messages: StoredMessage[]): void {
  const tx = db.transaction(() => {
    for (const msg of messages) {
      saveMessage(threadId, msg);
    }
  });
  tx();
}

export function getMessages(threadId: string): StoredMessage[] {
  const stmt = db.prepare(
    "SELECT message FROM messages WHERE thread_id = ? ORDER BY seq ASC"
  );
  const rows = stmt.all(threadId) as { message: string }[];
  return rows.map((r) => JSON.parse(r.message) as StoredMessage);
}

function getNextSeq(threadId: string): number {
  const stmt = db.prepare(
    "SELECT MAX(seq) as maxSeq FROM messages WHERE thread_id = ?"
  );
  const row = stmt.get(threadId) as { maxSeq: number | null };
  return (row.maxSeq ?? -1) + 1;
}
