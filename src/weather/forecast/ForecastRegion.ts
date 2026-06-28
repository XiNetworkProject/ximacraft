export interface ForecastRegion {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

export function regionAt(x: number, z: number, radius = 256): ForecastRegion {
  const westEast = x < -radius ? "Ouest" : x > radius ? "Est" : "Centre";
  const northSouth = z < -radius ? "Nord" : z > radius ? "Sud" : "";
  const name = [northSouth, westEast].filter(Boolean).join(" ") || "Position joueur";
  return {
    id: `${Math.round(x / radius)},${Math.round(z / radius)}`,
    name,
    x,
    z,
    radius,
  };
}
