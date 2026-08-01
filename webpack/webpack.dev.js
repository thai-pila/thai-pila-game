const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: "development",

  entry: path.resolve(__dirname, "../src/main.ts"),

  output: {
    path: path.resolve(__dirname, "../dist"),
    filename: "bundle.js",
    clean: true,
  },

  resolve: {
    extensions: [".ts", ".js"],
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "../src/index.html"),
    }),
    new CopyPlugin({
      patterns: [
        { from: path.resolve(__dirname, "../src/assets"), to: "assets" },
      ],
    }),
  ],

  devServer: {
    static: {
      directory: path.resolve(__dirname, "../dist"),
    },
    devMiddleware: {
      writeToDisk: true,
    },
    historyApiFallback: true,
    port: 3001,
    open: true,
    hot: true,
 
    client: {
      webSocketURL: "auto://0.0.0.0:0/ws",
    },
    allowedHosts: "all",
  },
};
