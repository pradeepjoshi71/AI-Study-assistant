module.exports = {
  apps: [
    {
      name: "api-service",
      script: "./dist/src/main.js",
      cwd: "./apps/api",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
