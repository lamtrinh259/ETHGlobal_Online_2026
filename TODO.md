# TODO

Product asks not yet built, in the words they were given. Each becomes a branch; ticked when it lands.

## `/p/<handle>` — references received

- [x] A rocker to filter off unsolicited references (the list keeps them; the reader chooses).
- [x] AI-assisted evaluation of what each reference says, as a badge on the reference itself — three
      kinds: critical / neutral / supportive, from `GET /v1/readings/:handle`; unread where no council
      is configured (`NSED_URL`).
- [x] "Refer this person" → write your own reference, from the list itself.

## `/p/<handle>` — references given

- [x] "Request a reference" from here (goes to your own page, where an invitation is made).
- [x] The same three-kind AI badge on each reference given.

## Checking against a policy

- [x] The policy input form needs a policy search: presets and the reader's own saved policies,
      found by typing, not by scanning buttons (`/p` had it; `/employers` has it now).

## `/w/<address>`

- [x] Must list references written to any page. The `kju-is` answer a wallet wrote (e.g.
      `/w/0xD70B5E8A232Bf67F64658cbDDebe32e1443894a0`) is missing from "given": the wallet route
      files every record in a name domain under "names", while the verify route counts the same
      record as a reference about the subject. One reading, in both places.
