const after = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$)).+$/su;
console.log("LS:", after.test("foo bar"));
console.log("PS:", after.test("foo bar"));
