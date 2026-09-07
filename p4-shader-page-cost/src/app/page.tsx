import scenarios from "../../scenarios.json";

import { ShaderStage } from "./ShaderStage.tsx";

export default function Page() {
  return <ShaderStage shaders={scenarios.shaders} />;
}
