/** PM2 process definition — keeps the tracker alive on a VPS.
 *  Usage: pm2 start ecosystem.config.js && pm2 save
 *  Note: runs the next binary directly (going through `npm` breaks on Windows PM2).
 */
module.exports = {
  apps: [
    {
      name: "airdrop-tracker",
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3111",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "600M",
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Jakarta",
        PORT: "3111",
      },
    },
  ],
};
