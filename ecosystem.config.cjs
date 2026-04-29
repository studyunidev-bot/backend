module.exports = {
  apps: [
    {
      name: 'demo-app-register-gat-pat-api',
      cwd: __dirname,
      script: 'npm',
      args: 'run start:prod',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3000',
        TRUST_PROXY: process.env.TRUST_PROXY || 'true',
      },
    },
  ],
};