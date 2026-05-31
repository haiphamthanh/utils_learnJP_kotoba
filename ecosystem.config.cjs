module.exports = {
  apps: [
    {
      name: "learn-jp-wordlist",
      script: "server.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "8000",
        TRUST_PROXY: "true",
      },
    },
  ],
};
