# UX pass

Requested in one sitting while using the deployed app. Ordered as they will be done, smallest
dependency first. Each line is its own commit.

## Done

- [x] **Remove the disclaimer line.** `This is not identity, employment, safety, malware, nationality,
      or affiliation verification.` no longer printed on any page. It stays in the API response, which
      is a contract other readers parse.
- [x] **Remove `/names`.** The page is gone from the nav and the routes; `docs/namespace.md` already
      holds the content. Its "Read a name" box went with it — worth putting back somewhere if the
      interactive part is missed.

## To do

1. [x] **Landing becomes the search.** "Check a candidate" is the front page: one search field,
       focused, sufficient on its own. Below it, the most referenced profiles, KJU first.
2. [x] **One input, stepwise.** `/verify` loses the two-mode toggle and the second field. Who → search
       → policy, in that order. Looking somebody up by an account of theirs stays, demoted.
3. [x] **Nobody holds that name.** Offer a claim link when the search names a social account or an
       email; otherwise say plainly that this makes a page nobody can link to a real account — a
       subject page, not a person's.
4. [x] **Same pattern on `/vouch`.** The writer finds the candidate the same way a verifier finds one.
5. [ ] **Merge `/v/` and `/p/`.** A person is one page. `/v/<handle>.<root>` goes to `/p/<handle>`;
       `/v/` keeps answering for names that are not people (accounts, references, mounts). "My profile"
       links to `/p/<handle>`.
6. [ ] **References, tabbed.** On the merged page, references given moves below the profile and shares
       a tab strip with references received.
7. [ ] **Score on the merged page.** The ring that is on `/me` belongs where a verifier reads.
8. [ ] **Custom policies.** A verifier can build and keep their own, not only pick a preset. A policy
       can name *who* must have referred — a handle, or a pattern like `*.acme.com` — alongside the
       counts it already has. The presets stay, as what the platform ships.
9. [ ] **`/trust` is spaghetti.** Cut the prose by ~80%. A diagram, the steps, and where the boundary
       is — not paragraphs.
