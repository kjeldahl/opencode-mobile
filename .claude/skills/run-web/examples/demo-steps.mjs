// Drives app/demo.tsx: summary line -> work pane -> expand edit card -> Allow.
// Run: node shot.mjs /demo <outDir> examples/demo-steps.mjs
export default async (page, shot) => {
  await page.getByTestId("turn-summary").last().click()
  await shot("work-pane")
  await page.getByText("Edit src/components/LoginButton.tsx").click()
  await shot("edit-expanded")
  await page.getByTestId("work-pane-close").click()
  await page.getByText("Allow", { exact: true }).click()
  await shot("after-allow")
}
