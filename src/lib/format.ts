/**
 * Waktu relatif bahasa Indonesia — biar kebaca sekilas tanpa mikir.
 * "baru saja", "5 mnt lalu", "3 jam lalu", "kemarin", "4 hari lalu",
 * lebih lama dari seminggu → tanggal singkat ("13 Okt").
 */
export function timeAgo(s: string): string {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  const mnt = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mnt < 1) return "baru saja";
  if (mnt < 60) return `${mnt} mnt lalu`;
  const jam = Math.floor(mnt / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari === 1) return "kemarin";
  if (hari < 7) return `${hari} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}
