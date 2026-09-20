import app from "@/app";
import { initCleanupUsersJob } from "@/jobs/cleanupUsers.job";
import { initImportWorker } from "@/jobs/import.worker";

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    initCleanupUsersJob();
    initImportWorker();
});

