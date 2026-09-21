import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { Message } from "../../types";
import { normalizeFileUrl } from "../../utils/formatters";
import {
  FileExistsInDownloads,
  SaveFileFromURL,
  GetDownloadPath,
  ShowInExplorer,
  isWailsRuntime,
} from "../../platform/bridge";

/** File message bubble with Download + Show in Explorer buttons */
export function FileMessageBubble({ message }: { message: Message }) {
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileName = message.fileName ?? "file";
  const canRevealDownloadedFile = isWailsRuntime;

  useEffect(() => {
    FileExistsInDownloads(fileName)
      .then(setDownloaded)
      .catch(() => {});
  }, [fileName]);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const rawUrl = message.fileUrl ?? "";
      const url = normalizeFileUrl(rawUrl) ?? rawUrl;
      await SaveFileFromURL(url, fileName);
      if (canRevealDownloadedFile) {
        setDownloaded(true);
      }
      toast.success("File downloaded!");
    } catch {
      toast.error("Download error");
    } finally {
      setDownloading(false);
    }
  };

  const handleShowInExplorer = async () => {
    try {
      const path = await GetDownloadPath(fileName);
      if (path) await ShowInExplorer(path);
    } catch {
      toast.error("Error opening file");
    }
  };

  return (
    <div className="file-msg-bubble">
      <div className="file-msg-name">📎 {fileName}</div>
      <div className="file-msg-actions">
        {!downloaded || !canRevealDownloadedFile ? (
          <button
            className="file-msg-btn file-download-btn"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? "⏳ Yuklanmoqda..." : "⬇ Download"}
          </button>
        ) : (
          <button
            className="file-msg-btn file-explorer-btn"
            onClick={handleShowInExplorer}
          >
            📂 Show in Explorer
          </button>
        )}
      </div>
    </div>
  );
}
