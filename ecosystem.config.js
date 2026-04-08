module.exports = {
  apps: [
    {
      name: 'tennis-matcher-server',
      script: './server.js',
      cwd: './server',
      instances: 1, // Start with 1, increase later if switching to Redis for Socket.io
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
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    }
  ]
};
