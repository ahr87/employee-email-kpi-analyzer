import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  { ignores: ["src/generated/**", ".next/**", "node_modules/**"] },
  // data-fetching hooks and form-state sync intentionally set state inside effects
  { rules: { "react-hooks/set-state-in-effect": "off", "@next/next/no-html-link-for-pages": "off" } }, // plain <a> is right for file downloads
];

export default config;
