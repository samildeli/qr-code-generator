import { useEffect, useState } from "react";

export default function useMediaQuery(mediaQuery: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(mediaQuery);
    setMatches(mediaQueryList.matches);
    mediaQueryList.onchange = (event) => setMatches(event.matches);
  }, [mediaQuery]);

  return matches;
}
