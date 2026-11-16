import { expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import ResumenAdmin from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

it("/admin/liga lleva a la portada, que ya muestra el resumen", () => {
  ResumenAdmin();
  expect(redirect).toHaveBeenCalledWith("/admin");
});
