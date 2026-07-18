// Root component — the entire application lives in ARGpredict.jsx; this file
// exists only so main.jsx has a stable top-level component to render.
import ARGpredict from "./components/ARGpredict.jsx";

export default function App() {
  return <ARGpredict />;
}
