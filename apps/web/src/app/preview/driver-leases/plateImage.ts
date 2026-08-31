import { renderPlateImage as render } from "@/lib/plateImage";
import { demoPlateData } from "./ui";
import type { Vehicle } from "./model";
export type { PlateImage } from "@/lib/plateImage";
export const renderPlateImage = (vehicle: Vehicle) => render(demoPlateData(vehicle));
