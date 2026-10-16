// Drives app/showcase.tsx: open the stats panel, open the wide-diff turn's work
// pane, expand the multi-hunk apply_patch card to show the folded diff, then
// reply to the permission prompt. Run: node shot.mjs /showcase <outDir> examples/showcase-steps.mjs
const click = async (target) => {
  try {
    await target.click({ timeout: 5000 })
  } catch {
    await target.click({ force: true })
  }
}

export default async (page, shot) => {
  await shot("initial")

  await click(page.getByTestId("header-stats"))
  await shot("stats")

  // "Called 3 tools, edited 3 files" is the turn carrying the wide apply_patch.
  const summaries = page.getByTestId("turn-summary")
  let target = -1
  for (let i = 0; i < (await summaries.count()); i++) {
    if ((await summaries.nth(i).innerText()).includes("edited 3 files")) target = i
  }
  if (target < 0) throw new Error("wide-diff turn not found")
  await click(summaries.nth(target))
  await shot("work-pane")

  await click(page.getByText("Apply patch: src/auth/keystore.ts (wide diff)"))
  await shot("fold-collapsed")

  const folds = page.getByTestId("diff-fold")
  if ((await folds.count()) === 0) throw new Error("no fold marker rendered — diff is not folded")
  await click(folds.first())
  await shot("fold-expanded")
  await click(folds.first())
  await shot("fold-expanded-more")

  await click(page.getByTestId("work-pane-close"))
  await click(page.getByText("Allow", { exact: true }))
  await shot("after-permission")
}
