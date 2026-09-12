# TODO

Product asks not yet built, in the words they were given. Each becomes a branch; ticked when it lands.

## `/p/<handle>` — references received

- [ ] A rocker to filter off unsolicited references (the list keeps them; the reader chooses).
- [ ] AI-assisted evaluation of what each reference says, as a badge on the reference itself — three
      kinds: negative / neutral / positive. The reading exists (`GET /v1/readings/:handle`, the fast
      council, summed in the "What the references say" card); the badge beside each entry in the
      Received list does not yet.
- [ ] "Refer this person" → write your own reference, from the list itself.

## `/p/<handle>` — references given

- [ ] "Request a reference" from here.
- [ ] The same three-kind AI badge on each reference given.

## Checking against a policy

- [ ] The policy input form needs a policy search: presets and the reader's own saved policies,
      found by typing, not by scanning buttons.

## `/w/<address>`

- [ ] Must list references written to any page. The `kju-is` answer a wallet wrote (e.g.
      `/w/0xD70B5E8A232Bf67F64658cbDDebe32e1443894a0`) is missing from "given": the wallet route
      files every record in a name domain under "names", while the verify route counts the same
      record as a reference about the subject. One reading, in both places.
