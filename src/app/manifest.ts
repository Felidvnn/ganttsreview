import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Orbit — Gestión de proyectos",
    short_name: "Orbit",
    description: "Planificación visual y colaborativa para equipos de ingeniería.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#0d2924",
    icons: [],
  };
}
