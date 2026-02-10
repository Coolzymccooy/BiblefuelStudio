import { appendQueueItem, readQueue, deleteQueueItem, clearQueue } from "./src/lib/store.js";
import fs from "fs";
import path from "path";

async function test() {
    console.log("--- Initial Queue ---");
    console.log(JSON.stringify(readQueue(), null, 2));

    console.log("\n--- Adding Item ---");
    const item = { id: "test-id", title: "Test Item", createdAt: new Date().toISOString() };
    appendQueueItem(item);

    console.log("\n--- Queue after Add ---");
    const q2 = readQueue();
    console.log(JSON.stringify(q2, null, 2));

    if (q2.items.length > 0) {
        console.log("✅ Success: Item was added and read back.");
    } else {
        console.log("❌ Failure: Item was not found in read result.");
    }
}

test().catch(console.error);
