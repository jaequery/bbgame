import Game from "@/components/Game";
import Hud from "@/components/Hud";
import { display, jp } from "./fonts";

export default function Home() {
  return (
    <main>
      <Game fonts={{ display: display.style.fontFamily, jp: jp.style.fontFamily }} />
      <Hud />
    </main>
  );
}
