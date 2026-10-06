// == follows IsLooselyEqual; relational operators and + follow ToPrimitive, ToNumber and ToString.
function show(label, value) {
  console.log(label, "->", value);
}
show("null == undefined", null == undefined);
show("null == 0", null == 0);
show("null >= 0", null >= 0);
show("undefined == 0", undefined == 0);
show("0 == ''", 0 == "");
show("0 == '0'", 0 == "0");
show("'' == '0'", "" == "0");
show("false == '0'", false == "0");
show("false == ''", false == "");
show("true == 1", true == 1);
show("true == '1'", true == "1");
show("true == 2", true == 2);
show("1 == '1'", 1 == "1");
show("1 === '1'", 1 === "1");
show("NaN == NaN", NaN == NaN);
show("NaN != NaN", NaN != NaN);
show("'b' == 'B'", "b" == "B");
show("'10' < '9'", "10" < "9");
show("'10' < 9", "10" < 9);
show("'a' < 'b'", "a" < "b");
show("null < 1", null < 1);
show("undefined < 1", undefined < 1);
show("'abc' < 1", "abc" < 1);

show("1 + '2'", 1 + "2");
show("'3' - 1", "3" - 1);
show("'5' * '2'", "5" * "2");
show("true + 1", true + 1);
show("null + 1", null + 1);
show("undefined + 1", undefined + 1);
show("'a' - 1", "a" - 1);
show("1 + 2 + '3'", 1 + 2 + "3");
show("'1' + 2 + 3", "1" + 2 + 3);

show("+''", +"");
show("+' 12 '", +" 12 ");
show("+'0x10'", +"0x10");
show("+'1e3'", +"1e3");
show("+'12px'", +"12px");
show("+null", +null);
show("+undefined", +undefined);
show("+true", +true);
show("!!''", !!"");
show("!!'0'", !!"0");
show("!!NaN", !!NaN);
show("!!{}", !!{});

// Objects convert through ToPrimitive: valueOf first for the default and number hints.
const answer = {
  valueOf() {
    return 42;
  },
  toString() {
    return "text";
  },
};
show("answer == 42", answer == 42);
show("answer == 'text'", answer == "text");
show("answer + 1", answer + 1);
show("answer + ''", answer + "");
show("`${answer}`", `${answer}`);
show("answer > 41", answer > 41);
const other = { valueOf: () => 42 };
show("answer == other", answer == other);
show("answer == answer", answer == answer);
show("null == false", null == false);
show("undefined == false", undefined == false);
