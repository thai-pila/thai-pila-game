const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: "production",

  entry: path.resolve(__dirname, "../src/main.ts"),

  output: {
    path: path.resolve(__dirname, "../dist"),
    filename: "bundle.[contenthash:8].js",
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
      minify: {
        removeComments: true,
        collapseWhitespace: true,
      },
    }),
    new CopyPlugin({
      patterns: [
        { from: path.resolve(__dirname, "../src/assets"), to: "assets" },
      ],
    }),
  ],
};
