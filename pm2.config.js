// pm2.config.js
// PM2 process manager configuration
// Start: pm2 start pm2.config.js
// Save:  pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: "hotspot-api",
      script: "./server.js",
      instances: "max",
      exec_mode: "cluster", 
      watch: false, 
      max_memory_restart: "500M",

      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // Auto-restart on crash
      restart_delay: 5000, // wait 5s before restart
      max_restarts: 10,
      min_uptime: "10s",

      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,

      // Zero-downtime reload
      kill_timeout: 5000, // wait 5s for graceful shutdown
    },
  ],
};
