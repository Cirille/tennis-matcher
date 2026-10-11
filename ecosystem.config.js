module.exports = {
  apps: [
    {
      name: 'tennis-matcher-server',
      script: './server.js',
      cwd: './server',
      instances: 1, // Required: SQLite session state and event ordering have one writer.
      exec_mode: 'fork',
      kill_timeout: 12000,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      // PM2 Logging configuration
      // Winston owns bounded application logs. Send process output to the service log.
      merge_logs: true,
      time: true
    }
  ]
};
