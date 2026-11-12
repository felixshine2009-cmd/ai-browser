/* polywasm 0.2.0 (https://github.com/evanw/polywasm), MIT License, Copyright (c) 2024 Evan Wallace.
   Converted to CommonJS with esbuild for the iPad Node runtime (nodejs-mobile has no WebAssembly on iOS). */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var polywasm_exports = {};
__export(polywasm_exports, {
  WebAssembly: () => wasmAPI
});
module.exports = __toCommonJS(polywasm_exports);
var buffer = new ArrayBuffer(8);
var f32 = new Float32Array(buffer);
var f64 = new Float64Array(buffer);
var i32 = new Int32Array(buffer);
var i64 = new BigInt64Array(buffer);
var u64 = new BigUint64Array(buffer);
var exportedFuncs = /* @__PURE__ */ new WeakMap();
var emptyArray = [];
var Trampoline = class {
};
var library = {
  N(x, y) {
    return (x < 0 || x === 0 && Object.is(x, -0)) !== (y < 0 || y === 0 && Object.is(y, -0)) ? -x : x;
  },
  p(x) {
    u64[0] = x;
    return i64[0];
  },
  O(x) {
    f32[0] = x;
    return i32[0];
  },
  P(x) {
    i32[0] = x;
    return f32[0];
  },
  Q(x) {
    f64[0] = x;
    return u64[0];
  },
  R(x) {
    u64[0] = x;
    return f64[0];
  },
  S(x, y) {
    return x << y | x >>> 32 - y;
  },
  T(x, y) {
    return x >>> y | x << 32 - y;
  },
  U(x, y) {
    return (x << y | x >> 64n - y) & 0xFFFFFFFFFFFFFFFFn;
  },
  V(x, y) {
    return (x >> y | x << 64n - y) & 0xFFFFFFFFFFFFFFFFn;
  },
  W(x) {
    return x ? Math.clz32(x & -x) ^ 31 : 32;
  },
  X(x) {
    let count = 0;
    while (x) {
      count++;
      x &= x - 1;
    }
    return count;
  },
  Y(x) {
    let count = Math.clz32(Number(x >> 32n & 0xFFFFFFFFn));
    if (count === 32) count += Math.clz32(Number(x & 0xFFFFFFFFn));
    return BigInt(count);
  },
  Z(x) {
    let y = Number(x & 0xFFFFFFFFn);
    if (y) return BigInt(Math.clz32(y & -y) ^ 31);
    y = Number(x >> 32n & 0xFFFFFFFFn);
    return y ? BigInt(32 + Math.clz32(y & -y) ^ 31) : 64n;
  },
  _(x) {
    let count = 0n;
    while (x) {
      count++;
      x &= x - 1n;
    }
    return count;
  },
  z(x) {
    x = Math.trunc(x);
    return x >= 2147483647 ? 2147483647 : x <= -2147483648 ? -2147483648 : x | 0;
  },
  A(x) {
    x = Math.trunc(x);
    return x >= 4294967295 ? -1 : x <= 0 ? 0 : x | 0;
  },
  B(x) {
    x = Math.trunc(x);
    return x >= 9223372036854776e3 ? 0x7FFFFFFFFFFFFFFFn : x <= -9223372036854776e3 ? 0x8000000000000000n : x === x ? BigInt(x) & 0xFFFFFFFFFFFFFFFFn : 0n;
  },
  C(x) {
    x = Math.trunc(x);
    return x >= 18446744073709552e3 ? 0xFFFFFFFFFFFFFFFFn : !(x > 0) ? 0n : (
      // NaN must become 0
      BigInt(x)
    );
  },
  $(x) {
    return x & 0x80n ? x | 0xFFFFFFFFFFFFFF00n : x & 0xFFn;
  },
  aa(x) {
    return x & 0x8000n ? x | 0xFFFFFFFFFFFF0000n : x & 0xFFFFn;
  },
  ba(x) {
    return x & 0x80000000n ? x | 0xFFFFFFFF00000000n : x & 0xFFFFFFFFn;
  },
  D(source, destination, target, start, count) {
    if (source === destination) {
      destination.copyWithin(target, start, start + count);
    } else {
      destination.set(source.subarray(start, start + count), target);
    }
  },
  E(x, y, d, s, n) {
    d >>>= 0;
    s >>>= 0;
    n >>>= 0;
    if (s + n > y.length || d + n > x.length) throw RangeError();
    if (d <= s) {
      for (let j = 0; j < n; j++) x[d + j] = y[s + j];
    } else {
      for (let j = n - 1; j >= 0; j--) x[d + j] = y[s + j];
    }
  },
  F(x, val, n) {
    const sz = x.length;
    n >>>= 0;
    if (sz + n > x.ca) return -1;
    for (let i = 0; i < n; i++) x.push(val);
    return sz;
  },
  da(x, i, val, n) {
    i >>>= 0;
    n >>>= 0;
    if (i + n > x.length) throw RangeError();
    for (let j = 0; j < n; j++) x[i + j] = val;
  },
  G(context, fn, args) {
    if (context instanceof Trampoline) {
      context.q = fn;
      context.ea = args;
      return emptyArray;
    }
    context = new Trampoline();
    let result;
    while (result = fn.apply(context, args), context.q) {
      fn = context.q;
      args = context.ea;
      context.q = null;
    }
    return result;
  },
  r(fn) {
    if (fn === null) return fn;
    const obj = exportedFuncs.get(fn);
    if (obj) return obj;
    throw Error("Unexpected foreign function object");
  },
  s(obj) {
    if (obj === null) return null;
    if (!obj.t) {
      const [argTypes, returnTypes] = obj.fa;
      const argNames = [];
      const argExprs = [];
      for (let i = 0; i < argTypes.length; i++) {
        argNames.push("a" + i);
        argExprs.push(castToWASM("a" + i, argTypes[i]));
      }
      let result = `f.${/* @__KEY__ */ "u"}(${argExprs})`;
      if (returnTypes.length === 1) {
        result = "return " + castToJS(result, returnTypes[0]);
      } else if (returnTypes.length > 1) {
        result = `let r=${result};`;
        for (let i = 0; i < returnTypes.length; i++) result += `r[${i}]=${castToJS(`r[${i}]`, returnTypes[i])};`;
        result += "return r";
      }
      exportedFuncs.set(obj.t = new Function("f", "l", `return(${argNames})=>{${result}}`)(obj, this), obj);
    }
    return obj.t;
  }
};
var isPayload = (operand) => {
  return typeof operand === "string" ? operand >= "P" && operand <= "S" : operand ? typeof operand[0] !== "string" && operand[0] < 0 : false;
};
var rules = [
  // load of (addr + constant) => merge constant into load's offset
  {
    a: [
      [
        "$",
        40,
        41,
        42,
        43,
        44,
        45,
        46,
        47,
        48,
        49,
        50,
        51,
        52,
        53
        /* i64_load32_u */
      ],
      [106, "x", [65, "Q"]],
      "P",
      "R"
    ],
    b: ["$", "x", [-2, "P", "Q"], "R"]
  },
  // store of (addr + constant) => merge constant into store's offset
  {
    a: [
      [
        "$",
        54,
        55,
        56,
        57,
        58,
        59,
        60,
        61,
        62
        /* i64_store32 */
      ],
      [106, "x", [65, "Q"]],
      "y",
      "P",
      "R"
    ],
    b: ["$", "x", "y", [-2, "P", "Q"], "R"]
  },
  // i64_store8 => i32_store8
  {
    a: [60, "x", "y", "P", "R"],
    f: {
      "y": [
        {
          a: [66, "Q"],
          b: [58, "x", [65, [-1, "Q"]], "P", "R"]
        },
        {
          a: [
            [
              "$",
              48,
              49,
              50,
              51,
              52,
              53,
              41
              /* i64_load */
            ],
            "z",
            "Q",
            "S"
          ],
          b: [58, "x", [45, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [[
            "@",
            172,
            173
            /* i64_extend_i32_u */
          ], "z"],
          b: [58, "x", "z", "P", "R"]
        }
      ]
    }
  },
  // i64_store16 => i32_store16
  {
    a: [61, "x", "y", "P", "R"],
    f: {
      "y": [
        {
          a: [66, "Q"],
          b: [59, "x", [65, [-1, "Q"]], "P", "R"]
        },
        {
          a: [48, "z", "Q", "S"],
          b: [59, "x", [44, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [49, "z", "Q", "S"],
          b: [59, "x", [45, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [
            [
              "$",
              50,
              51,
              52,
              53,
              41
              /* i64_load */
            ],
            "z",
            "Q",
            "S"
          ],
          b: [59, "x", [47, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [[
            "@",
            172,
            173
            /* i64_extend_i32_u */
          ], "z"],
          b: [59, "x", "z", "P", "R"]
        }
      ]
    }
  },
  // i64_store32 => i32_store
  {
    a: [62, "x", "y", "P", "R"],
    f: {
      "y": [
        {
          a: [66, "Q"],
          b: [54, "x", [65, [-1, "Q"]], "P", "R"]
        },
        {
          a: [48, "z", "Q", "S"],
          b: [54, "x", [44, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [49, "z", "Q", "S"],
          b: [54, "x", [45, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [50, "z", "Q", "S"],
          b: [54, "x", [46, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [51, "z", "Q", "S"],
          b: [54, "x", [47, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [
            [
              "$",
              52,
              53,
              41
              /* i64_load */
            ],
            "z",
            "Q",
            "S"
          ],
          b: [54, "x", [40, "z", "Q", "S"], "P", "R"]
        },
        {
          a: [[
            "@",
            172,
            173
            /* i64_extend_i32_u */
          ], "z"],
          b: [54, "x", "z", "P", "R"]
        }
      ]
    }
  },
  // i64_eqz => i32_eqz
  {
    a: [80, "x"],
    f: {
      "x": [
        {
          a: [[
            "$",
            48,
            49
            /* i64_load8_u */
          ], "y", "P", "R"],
          b: [69, [45, "y", "P", "R"]]
        },
        {
          a: [[
            "$",
            50,
            51
            /* i64_load16_u */
          ], "y", "P", "R"],
          b: [69, [47, "y", "P", "R"]]
        },
        {
          a: [[
            "$",
            52,
            53
            /* i64_load32_u */
          ], "y", "P", "R"],
          b: [69, [40, "y", "P", "R"]]
        },
        {
          a: [[
            "@",
            172,
            173
            /* i64_extend_i32_u */
          ], "y"],
          b: [69, "y"]
        }
      ]
    }
  },
  // 64-bit equality on unsigned 32-bit load => 32-bit equality
  {
    a: [81, [49, "x", "P", "R"], [66, "Q"]],
    b: [70, [45, "x", "P", "R"], [65, [-1, "Q"]]],
    d: ["Q", "<=", 0xFFn]
  },
  {
    a: [82, [49, "x", "P", "R"], [66, "Q"]],
    b: [71, [45, "x", "P", "R"], [65, [-1, "Q"]]],
    d: ["Q", "<=", 0xFFn]
  },
  {
    a: [81, [51, "x", "P", "R"], [66, "Q"]],
    b: [70, [47, "x", "P", "R"], [65, [-1, "Q"]]],
    d: ["Q", "<=", 0xFFFFn]
  },
  {
    a: [82, [51, "x", "P", "R"], [66, "Q"]],
    b: [71, [47, "x", "P", "R"], [65, [-1, "Q"]]],
    d: ["Q", "<=", 0xFFFFn]
  },
  {
    a: [81, [53, "x", "P", "R"], [66, "Q"]],
    b: [70, [40, "x", "P", "R"], [65, [-1, "Q"]]],
    d: ["Q", "<=", 0xFFFFFFFFn]
  },
  {
    a: [82, [53, "x", "P", "R"], [66, "Q"]],
    b: [71, [40, "x", "P", "R"], [65, [-1, "Q"]]],
    d: ["Q", "<=", 0xFFFFFFFFn]
  },
  // Optimize boolean operations
  {
    a: [240, "x"],
    f: {
      "x": [
        // "if (x ? 1 : 0)" => "if (x)"
        { a: [242, "y"], b: [240, "y"] },
        // "if (x ? 0 : 1)" => "if (!x)"
        { a: [[
          "@",
          69,
          80
          /* i64_eqz */
        ], "x"], b: [241, "y"] }
      ]
    }
  },
  {
    a: [241, "x"],
    f: {
      "x": [
        // "if (!(x ? 1 : 0))" => "if (!x)"
        { a: [242, "y"], b: [241, "y"] },
        // "if (!(x ? 0 : 1)" => "if (x)"
        { a: [[
          "@",
          69,
          80
          /* i64_eqz */
        ], "y"], b: [240, "y"] },
        // "if (!(x === 0))" => "if (x !== 0)" (note: does not apply to floating-point due to NaN)
        { a: [70, "y", "z"], b: [240, [71, "y", "z"]] },
        { a: [71, "y", "z"], b: [240, [70, "y", "z"]] },
        { a: [72, "y", "z"], b: [240, [78, "y", "z"]] },
        { a: [73, "y", "z"], b: [240, [79, "y", "z"]] },
        { a: [74, "y", "z"], b: [240, [76, "y", "z"]] },
        { a: [75, "y", "z"], b: [240, [77, "y", "z"]] },
        { a: [76, "y", "z"], b: [240, [74, "y", "z"]] },
        { a: [77, "y", "z"], b: [240, [75, "y", "z"]] },
        { a: [78, "y", "z"], b: [240, [72, "y", "z"]] },
        { a: [79, "y", "z"], b: [240, [73, "y", "z"]] },
        { a: [81, "y", "z"], b: [240, [82, "y", "z"]] },
        { a: [82, "y", "z"], b: [240, [81, "y", "z"]] },
        { a: [83, "y", "z"], b: [240, [89, "y", "z"]] },
        { a: [84, "y", "z"], b: [240, [90, "y", "z"]] },
        { a: [85, "y", "z"], b: [240, [87, "y", "z"]] },
        { a: [86, "y", "z"], b: [240, [88, "y", "z"]] },
        { a: [87, "y", "z"], b: [240, [85, "y", "z"]] },
        { a: [88, "y", "z"], b: [240, [86, "y", "z"]] },
        { a: [89, "y", "z"], b: [240, [83, "y", "z"]] },
        { a: [90, "y", "z"], b: [240, [84, "y", "z"]] }
      ]
    }
  },
  // Optimize sign conversions
  {
    a: [243, "x"],
    f: {
      "x": [
        {
          a: [40, "y", "P", "R"],
          b: [245, "y", "P", "R"]
        }
      ]
    }
  },
  {
    a: [244, "x"],
    f: {
      "x": [
        {
          a: [41, "y", "P", "R"],
          b: [246, "y", "P", "R"]
        },
        // No sign conversion is needed for values in the shared signed/unsigned range
        {
          a: [66, "P"],
          b: [66, "P"],
          d: ["P", "<=", 0x7FFFFFFFFFFFFFFFn]
        },
        {
          a: [[
            "$",
            49,
            51,
            53
            /* i64_load32_u */
          ], "y", "P", "R"],
          b: ["$", "y", "P", "R"]
        }
      ]
    }
  },
  // i32_wrap_i64 removal
  {
    a: [167, "x"],
    f: {
      "x": [
        {
          a: [66, "P"],
          b: [65, [-1, "P"]]
        },
        {
          a: [48, "y", "P", "R"],
          b: [44, "y", "P", "R"]
        },
        {
          a: [49, "y", "P", "R"],
          b: [45, "y", "P", "R"]
        },
        {
          a: [50, "y", "P", "R"],
          b: [46, "y", "P", "R"]
        },
        {
          a: [51, "y", "P", "R"],
          b: [47, "y", "P", "R"]
        },
        {
          a: [[
            "$",
            52,
            53,
            41
            /* i64_load */
          ], "y", "P", "R"],
          b: [40, "y", "P", "R"]
        },
        {
          a: [[
            "@",
            172,
            173
            /* i64_extend_i32_u */
          ], "y"],
          b: "y"
        },
        {
          a: [124, [[
            "@",
            172,
            173
            /* i64_extend_i32_u */
          ], "y"], [66, "P"]],
          b: [106, "y", [65, [-1, "P"]]]
        }
      ]
    }
  },
  // i64_and
  {
    a: [131, "x", [66, "P"]],
    f: {
      "x": [
        {
          a: [66, "Q"],
          b: [66, [-3, "P", "Q"]]
        },
        {
          a: [131, "y", [66, "Q"]],
          b: [131, "y", [66, [-3, "P", "Q"]]]
        },
        {
          a: [49, "y", "Q", "S"],
          b: [49, "y", "Q", "S"],
          d: [["P", "&", 0xFFn], "===", 0xFFn]
        },
        {
          a: [48, "y", "Q", "S"],
          b: [49, "y", "Q", "S"],
          d: ["P", "===", 0xFFn]
        },
        {
          a: [51, "y", "Q", "S"],
          b: [51, "y", "Q", "S"],
          d: [["P", "&", 0xFFFFn], "===", 0xFFFFn]
        },
        {
          a: [50, "y", "Q", "S"],
          b: [51, "y", "Q", "S"],
          d: ["P", "===", 0xFFFFn]
        },
        {
          a: [53, "y", "Q", "S"],
          b: [53, "y", "Q", "S"],
          d: [["P", "&", 0xFFFFFFFFn], "===", 0xFFFFFFFFn]
        },
        {
          a: [52, "y", "Q", "S"],
          b: [53, "y", "Q", "S"],
          d: ["P", "===", 0xFFFFFFFFn]
        }
      ]
    }
  }
];
var compileOptimizations = () => {
  let nextVar = 0;
  const newVarName = () => "v" + nextVar++;
  const compileOperand = (ptrVar, index, operands, reusableNodes, then) => {
    if (index < operands.length) {
      const operand = operands[index];
      if (typeof operand === "string") {
        placeholderExprs[operand] = `${astVar}[${ptrVar}+${index + 1}]`;
        compileOperand(ptrVar, index + 1, operands, reusableNodes, then);
      } else {
        const childPtr = newVarName();
        const childOp = newVarName();
        code += `var ${childPtr}=${astVar}[${ptrVar}+${index + 1}],${childOp}=${astVar}[${childPtr}]&${65535};`;
        compileMatch(childPtr, childOp, operand, reusableNodes, (reusableNodes2) => {
          compileOperand(ptrVar, index + 1, operands, reusableNodes2, then);
        });
      }
    } else {
      then(reusableNodes);
    }
  };
  const compileMatch = (ptrVar, opVar, [pattern, ...operands], reusableNodes, then) => {
    const parts = [];
    if (typeof pattern === "number") {
      parts.push(`${opVar}===${pattern}`);
    } else {
      const [name, ...oneOf] = pattern;
      oneOf.sort((a, b) => a - b);
      oneOfOps[name] = {
        v: ptrVar,
        ga: opVar,
        ha: oneOf.some((x) => opCanBeOptimized.has(x))
      };
      for (let i = 0; i < oneOf.length; i++) {
        let run = 1;
        while (i + run < oneOf.length && oneOf[i + run - 1] + 1 === oneOf[i + run]) run++;
        parts.push(run > 2 ? `${opVar}>=${oneOf[i]}&&${opVar}<=${oneOf[i += run - 1]}` : `${opVar}===${oneOf[i]}`);
      }
    }
    reusableNodes = reusableNodes.concat({
      v: ptrVar,
      w: operands.map((x) => typeof x === "string" ? x : null)
    });
    code += `if(${parts.join("||")}){`;
    compileOperand(ptrVar, 0, operands, reusableNodes, then);
    code += "}";
  };
  const compileRules = (ptrVar, opVar, rules2, buildStatName, reusableNodes, placeholderVarsFromParent) => {
    for (const { a: match, f: nested, b: replace, d: onlyIf } of rules2) {
      compileMatch(ptrVar, opVar, match, reusableNodes, (reusableNodes2) => {
        const placeholderVars = Object.create(placeholderVarsFromParent);
        compileOnlyIf(onlyIf, placeholderVars, () => {
          if (nested) {
            for (const operand in nested) {
              storePlaceholderExprToVar(operand, placeholderVars);
            }
            for (const operand in nested) {
              const childPtrVar = placeholderVars[operand];
              const childOpVar = newVarName();
              code += `var ${childOpVar}=${astVar}[${childPtrVar}]&${65535};`;
              compileRules(
                childPtrVar,
                childOpVar,
                nested[operand],
                false ? (subMatch) => buildStatName(substituteMatch(match, operand, subMatch)) : null,
                reusableNodes2,
                placeholderVars
              );
            }
          }
          if (replace) {
            if (false) code += `${recordStatsVar}(${JSON.stringify(buildStatName(match))});`;
            const replacePtr = constructReplacement(replace, placeholderVars, reusableNodes2.slice(), `|${astVar}[${rootPtrVar}]&${~0 << 24}`);
            const optimizeAgain = typeof replace !== "string" && (typeof replace[0] === "string" ? oneOfOps[replace[0]].ha : opCanBeOptimized.has(replace[0]));
            if (optimizeAgain) {
              if (rootPtrVar !== replacePtr) code += `${rootPtrVar}=${replacePtr};`;
              code += "continue";
            } else {
              code += "return " + replacePtr;
            }
          }
        });
      });
    }
  };
  const compileOnlyIf = (onlyIf, placeholderVars, then) => {
    if (onlyIf) {
      const compileCheck = (onlyIf2) => {
        if (typeof onlyIf2 === "string") {
          return `${constantsVar}[${placeholderVars[onlyIf2] || placeholderExprs[onlyIf2]}]&0xFFFFFFFFFFFFFFFFn`;
        }
        if (typeof onlyIf2 === "bigint") {
          return onlyIf2 + "n";
        }
        return `(${compileCheck(onlyIf2[0])})${onlyIf2[1]}(${compileCheck(onlyIf2[2])})`;
      };
      code += `if(${compileCheck(onlyIf)}){`;
      then();
      code += "}";
    } else {
      then();
    }
  };
  const storePlaceholderExprToVar = (operand, placeholderVars) => {
    if (!(operand in placeholderVars)) {
      const childPtr = newVarName();
      code += `var ${childPtr}=${placeholderExprs[operand]};`;
      placeholderVars[operand] = childPtr;
    }
  };
  const constructReplacement = (replace, placeholderVars, reusableNodes, outStackSlot = "") => {
    if (typeof replace === "string") return placeholderVars[replace] || placeholderExprs[replace];
    if (replace[0] === -1) {
      const operand = constructReplacement(replace[1], placeholderVars, reusableNodes);
      return `Number(${constantsVar}[${operand}]&0xFFFFFFFFn)`;
    }
    if (replace[0] === -2) {
      const operand1 = constructReplacement(replace[1], placeholderVars, reusableNodes);
      const operand2 = constructReplacement(replace[2], placeholderVars, reusableNodes);
      return `${operand1}+${operand2}`;
    }
    if (replace[0] === -3) {
      const replace1 = replace[1];
      if (typeof replace1 === "string") {
        storePlaceholderExprToVar(replace1, placeholderVars);
      }
      const operand1 = constructReplacement(replace1, placeholderVars, reusableNodes);
      const operand2 = constructReplacement(replace[2], placeholderVars, reusableNodes);
      code += `${constantsVar}[${operand1}]&=${constantsVar}[${operand2}];`;
      return operand1;
    }
    const [op, ...operands] = replace;
    const childCountWithoutPayloads = operands.length - +isPayload(operands[operands.length - 1]) - +isPayload(operands[operands.length - 2]);
    const shiftedChildCount = childCountWithoutPayloads << 16;
    let bestScore = -1;
    let bestIndex;
    let newPtr;
    let existingOperands;
    for (let i = 0; i < reusableNodes.length; i++) {
      const reusableNode = reusableNodes[i];
      if (reusableNode.w.length === operands.length) {
        let score = 0;
        for (let i2 = 0; i2 < operands.length; i2++) {
          if (operands[i2] === reusableNode.w[i2]) {
            score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
          newPtr = reusableNode.v;
          existingOperands = reusableNode.w;
        }
      }
    }
    if (typeof op === "string" && oneOfOps[op].v === newPtr) {
    } else {
      const node = (typeof op === "string" ? `${oneOfOps[op].ga}|${shiftedChildCount}` : `${op | shiftedChildCount}`) + outStackSlot;
      if (newPtr) {
        reusableNodes.splice(bestIndex, 1);
        code += `${astVar}[${newPtr}]=${node};`;
      } else {
        newPtr = newVarName();
        code += `var ${newPtr}=${allocateNode}(${node},${replace.length});`;
      }
    }
    for (let i = 0; i < operands.length; i++) {
      if (existingOperands && operands[i] !== existingOperands[i]) {
        const value = constructReplacement(operands[i], placeholderVars, reusableNodes);
        code += `${astVar}[${newPtr}+${i + 1}]=${value};`;
      }
    }
    return newPtr;
  };
  const placeholderExprs = {};
  const oneOfOps = {};
  const recordStatsVar = newVarName();
  const astVar = newVarName();
  const constantsVar = newVarName();
  const allocateNode = newVarName();
  const rootPtrVar = newVarName();
  const rootOpVar = newVarName();
  const opCanBeOptimized = /* @__PURE__ */ new Set();
  for (const { a: [pattern] } of rules) {
    if (typeof pattern === "number") {
      opCanBeOptimized.add(pattern);
    } else {
      const [, ...oneOf] = pattern;
      for (const op of oneOf) opCanBeOptimized.add(op);
    }
  }
  let code = `for(;;){var ${rootOpVar}=${astVar}[${rootPtrVar}]&${65535};`;
  compileRules(rootPtrVar, rootOpVar, rules, false ? matchToStatName : null, [], {});
  code += `return ${rootPtrVar}}`;
  return false ? new Function(recordStatsVar, `return(${astVar},${constantsVar},${allocateNode},${rootPtrVar})=>{${code}}`)(recordStats) : new Function(astVar, constantsVar, allocateNode, rootPtrVar, code);
};
var parse = (bytes) => {
  const dataView = new DataView(bytes.buffer);
  const readU32LEB = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[ptr++];
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value >>> 0;
  };
  const readI32LEB = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[ptr++];
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return shift < 32 && byte & 64 ? value | ~0 << shift : value;
  };
  const readI64LEB = () => {
    let value = 0n;
    let shift = 0n;
    let byte;
    do {
      byte = bytes[ptr++];
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    } while (byte & 128);
    return shift < 64 && byte & 64 ? value | ~0n << shift : value;
  };
  const readF32 = () => {
    const value = dataView.getFloat32(ptr, true);
    ptr += 4;
    return value;
  };
  const readF64 = () => {
    const value = dataView.getFloat64(ptr, true);
    ptr += 8;
    return value;
  };
  const readValueTypes = (count = readU32LEB()) => {
    return [...bytes.slice(ptr, ptr += count)];
  };
  const readName = (length = readU32LEB()) => {
    return decodeURIComponent(escape(String.fromCharCode(...bytes.slice(ptr, ptr += length))));
  };
  const readLimits = (kind = bytes[ptr++]) => {
    return [readU32LEB(), kind === 0 ? Infinity : readU32LEB()];
  };
  const readConstantU32 = () => {
    const stack = [];
    let op;
    while ((op = bytes[ptr++]) !== 11) {
      if (op === 65) {
        const value = readU32LEB();
        stack.push(() => value);
      } else if (op === 35) {
        const index = readU32LEB();
        stack.push((globals) => {
          if (index >= globals.length) throw RangeError();
          return globals[index];
        });
      } else if (op === 106) {
        const right = stack.pop(), left = stack.pop();
        stack.push((globals) => left(globals) + right(globals) | 0);
      } else if (op === 107) {
        const right = stack.pop(), left = stack.pop();
        stack.push((globals) => left(globals) - right(globals) | 0);
      } else if (op === 108) {
        const right = stack.pop(), left = stack.pop();
        stack.push((globals) => Math.imul(left(globals), right(globals)));
      } else {
        throw new CompileError("Unsupported constant instruction: " + formatHexByte(op));
      }
    }
    if (stack.length !== 1) throw new CompileError("Unsupported constant");
    return stack[0];
  };
  const readConstantFuncIndex = () => {
    const op = bytes[ptr++];
    let value;
    if (op === 210) value = readU32LEB();
    else if (op === 208) {
      if (bytes[ptr++] !== 112) throw new CompileError("Unsupported reference type: " + formatHexByte(bytes[ptr - 1]));
      value = null;
    } else throw new CompileError("Unsupported constant instruction: " + formatHexByte(op));
    if (bytes[ptr++] !== 11) throw new CompileError("Expected end after constant: " + formatHexByte(bytes[ptr - 1]));
    return value;
  };
  const readInitializer = (type) => {
    const op = bytes[ptr++];
    let initializer;
    if (op === 65 && type === 127) {
      const value = readI32LEB();
      initializer = () => value;
    } else if (op === 66 && type === 126) {
      const value = readI64LEB();
      initializer = () => value;
    } else if (op === 67 && type === 125) {
      const value = readF32();
      initializer = () => value;
    } else if (op === 68 && type === 124) {
      const value = readF64();
      initializer = () => value;
    } else if (op === 208 && (type === 112 || type === 111)) {
      ptr++;
      initializer = () => null;
    } else if (op === 210 && type === 112) {
      const index = readU32LEB();
      initializer = (_, createLazyFunc) => createLazyFunc(index);
    } else if (op === 35) {
      const index = readU32LEB();
      initializer = (globals) => {
        if (index >= globals.length) throw RangeError();
        return globals[index];
      };
    } else throw new CompileError("Unsupported constant instruction: " + formatHexByte(op));
    if (bytes[ptr++] !== 11) throw new CompileError("Expected end after constant: " + formatHexByte(bytes[ptr - 1]));
    return initializer;
  };
  const codeSection = [];
  const customSections = [];
  const dataSection = [];
  const elementSection = [];
  const exportSection = [];
  const functionSection = [];
  const globalSection = [];
  const importSection = [];
  const memorySection = [];
  const nameSection = /* @__PURE__ */ new Map();
  const tableSection = [];
  const typeSection = [];
  let startSection = -1;
  let ptr = 8;
  if (bytes.slice(0, 8).join(",") !== "0,97,115,109,1,0,0,0")
    throw new CompileError("Invalid file header");
  while (ptr + 5 < bytes.length) {
    const sectionType = bytes[ptr++];
    const contentsSize = readU32LEB();
    const sectionEnd = ptr + contentsSize;
    if (sectionType === 0) {
      const sectionName = readName();
      customSections.push([sectionName, bytes.slice(ptr, sectionEnd)]);
      if (sectionName === "name") {
        const subsection = bytes[ptr++];
        const subsectionEnd = ptr + readU32LEB();
        if (subsection === 1) {
          for (let i = 0, count = readU32LEB(); i < count && ptr < subsectionEnd; i++) {
            nameSection.set(readU32LEB(), readName());
          }
        }
      }
    } else if (sectionType === 1) {
      for (let i = 0, typeCount = readU32LEB(); i < typeCount; i++) {
        if (bytes[ptr++] !== 96) throw new CompileError("Invalid function type: " + formatHexByte(bytes[ptr - 1]));
        typeSection.push([readValueTypes(), readValueTypes()]);
      }
    } else if (sectionType === 2) {
      for (let i = 0, importCount = readU32LEB(); i < importCount; i++) {
        const module2 = readName();
        const name = readName();
        const desc = bytes[ptr++];
        if (desc === 0) importSection.push([module2, name, desc, readU32LEB()]);
        else if (desc === 1) importSection.push([module2, name, desc, bytes[ptr++], ...readLimits()]);
        else if (desc === 2) importSection.push([module2, name, desc, ...readLimits()]);
        else if (desc === 3) importSection.push([module2, name, desc, bytes[ptr++], bytes[ptr++]]);
        else throw new CompileError("Unsupported import type: " + formatHexByte(desc));
      }
    } else if (sectionType === 3) {
      const functionCount = readU32LEB();
      for (let i = 0; i < functionCount; i++) {
        functionSection.push(readU32LEB());
      }
    } else if (sectionType === 4) {
      for (let i = 0, tableCount = readU32LEB(); i < tableCount; i++) {
        tableSection.push([bytes[ptr++], ...readLimits()]);
      }
    } else if (sectionType === 5) {
      for (let i = 0, memoryCount = readU32LEB(); i < memoryCount; i++) {
        memorySection.push(readLimits());
      }
    } else if (sectionType === 6) {
      for (let i = 0, globalCount = readU32LEB(); i < globalCount; i++) {
        const type = bytes[ptr++];
        const mutable = bytes[ptr++];
        const initializer = readInitializer(type);
        globalSection.push([type, mutable, initializer]);
      }
    } else if (sectionType === 7) {
      for (let i = 0, exportCount = readU32LEB(); i < exportCount; i++) {
        const name = readName();
        const desc = bytes[ptr++];
        const index = readU32LEB();
        exportSection.push([name, desc, index]);
      }
    } else if (sectionType === 8) {
      startSection = readU32LEB();
    } else if (sectionType === 9) {
      for (let i = 0, elementCount = readU32LEB(); i < elementCount; i++) {
        const flags = readU32LEB();
        if (flags > (1 | 2 | 4)) {
          throw new CompileError("Unsupported element kind: " + flags);
        }
        const mode = flags & (1 | 2);
        const tableIndex = mode === 2 ? readU32LEB() : mode === 0 ? 0 : null;
        const offset = flags & 1 ? null : readConstantU32();
        if (mode && bytes[ptr++] !== (flags & 4 ? 112 : 0)) {
          throw new CompileError("Unsupported element type: " + formatHexByte(bytes[ptr - 1]));
        }
        const indices = [];
        for (let j = 0, count = readU32LEB(); j < count; j++) {
          indices.push(flags & 4 ? readConstantFuncIndex() : readU32LEB());
        }
        elementSection.push([tableIndex, offset, indices]);
      }
    } else if (sectionType === 10) {
      for (let i = 0, codeCount = readU32LEB(); i < codeCount; i++) {
        const codeEnd = readU32LEB() + ptr;
        const localsCount = readU32LEB();
        const locals = [];
        for (let j = 0; j < localsCount; j++) locals.push([readU32LEB(), bytes[ptr++]]);
        codeSection.push([locals, ptr, codeEnd]);
        ptr = codeEnd;
      }
    } else if (sectionType === 11) {
      for (let i = 0, dataCount = readU32LEB(); i < dataCount; i++) {
        const mode = readU32LEB();
        if (mode > 2) throw new CompileError("Unsupported data mode: " + mode);
        const memory = mode === 2 ? readU32LEB() : 0;
        const offset = mode === 1 ? null : readConstantU32();
        const length = readU32LEB();
        dataSection.push([memory, offset, bytes.slice(ptr, ptr += length)]);
      }
    } else if (sectionType === 12) {
    } else {
      throw new CompileError("Unsupported section type: " + formatHexByte(sectionType));
    }
    ptr = sectionEnd;
  }
  return {
    ia: bytes,
    h: dataView,
    H: codeSection,
    ta: customSections,
    ja: dataSection,
    ka: elementSection,
    la: exportSection,
    I: functionSection,
    ma: globalSection,
    na: importSection,
    oa: memorySection,
    pa: nameSection,
    qa: startSection,
    ra: tableSection,
    J: typeSection
  };
};
var formatHexByte = (x) => {
  return "0x" + x.toString(16).toUpperCase().padStart(2, "0");
};
var moduleMap = /* @__PURE__ */ new Map();
var Module = class {
  constructor(source) {
    moduleMap.set(this, parse(source instanceof Uint8Array ? source : new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer)));
  }
};
var CompileError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CompileError";
  }
};
var liveCastToWASM = (value, type) => {
  if (type === 125 || type === 124) return +value;
  if (type === 127) return value | 0;
  if (type === 126) return BigInt(value) & 0xFFFFFFFFFFFFFFFFn;
  if (type === 111) return value;
  throw Error("Unsupported cast to type: " + formatHexByte(type));
};
var castToWASM = (code, type) => {
  if (type === 125 || type === 124) return "+" + code;
  if (type === 127) return code + "|0";
  if (type === 126) return `BigInt(${code})&0xFFFFFFFFFFFFFFFFn`;
  if (type === 111) return code;
  if (type === 112) return `l.${/* @__KEY__ */ "r"}(${code})`;
  throw Error("Unsupported cast to type: " + formatHexByte(type));
};
var castToJS = (code, type) => {
  if (type === 124 || type === 127) return code;
  if (type === 125) return `Math.fround(${code})`;
  if (type === 126) return `l.${/* @__KEY__ */ "p"}(${code})`;
  if (type === 111) return code;
  if (type === 112) return `l.${/* @__KEY__ */ "s"}(${code})`;
  throw Error("Unsupported cast to type: " + formatHexByte(type));
};
var metaTable = {
  [
    1
    /* nop */
  ]: 512 | 8,
  [
    26
    /* drop */
  ]: 1 | 512 | 8,
  [
    32
    /* local_get */
  ]: 4 | 16 | 8,
  [
    33
    /* local_set */
  ]: 1 | 16 | 8,
  [
    34
    /* local_tee */
  ]: 1 | 4 | 16 | 8,
  [
    35
    /* global_get */
  ]: 4 | 16 | 8,
  [
    36
    /* global_set */
  ]: 1 | 16 | 8,
  [
    37
    /* table_get */
  ]: 1 | 4 | 16 | 8,
  [
    38
    /* table_set */
  ]: 2 | 16 | 8,
  [
    40
    /* i32_load */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    41
    /* i64_load */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    42
    /* f32_load */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    43
    /* f64_load */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    44
    /* i32_load8_s */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    45
    /* i32_load8_u */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    46
    /* i32_load16_s */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    47
    /* i32_load16_u */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    48
    /* i64_load8_s */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    49
    /* i64_load8_u */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    50
    /* i64_load16_s */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    51
    /* i64_load16_u */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    52
    /* i64_load32_s */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    53
    /* i64_load32_u */
  ]: 1 | 4 | 32 | 16 | 8,
  [
    54
    /* i32_store */
  ]: 2 | 32 | 16 | 8,
  [
    55
    /* i64_store */
  ]: 2 | 32 | 16 | 8,
  [
    56
    /* f32_store */
  ]: 2 | 32 | 16 | 8,
  [
    57
    /* f64_store */
  ]: 2 | 32 | 16 | 8,
  [
    58
    /* i32_store8 */
  ]: 2 | 32 | 16 | 8,
  [
    59
    /* i32_store16 */
  ]: 2 | 32 | 16 | 8,
  [
    60
    /* i64_store8 */
  ]: 2 | 32 | 16 | 8,
  [
    61
    /* i64_store16 */
  ]: 2 | 32 | 16 | 8,
  [
    62
    /* i64_store32 */
  ]: 2 | 32 | 16 | 8,
  [
    63
    /* memory_size */
  ]: 4 | 16 | 8,
  [
    64
    /* memory_grow */
  ]: 1 | 4 | 16 | 8,
  [
    69
    /* i32_eqz */
  ]: 1 | 4 | 8,
  [
    70
    /* i32_eq */
  ]: 2 | 4 | 8 | 64,
  [
    71
    /* i32_ne */
  ]: 2 | 4 | 8 | 64,
  [
    72
    /* i32_lt_s */
  ]: 2 | 4 | 8 | 64,
  [
    73
    /* i32_lt_u */
  ]: 2 | 4 | 8 | 64 | 128,
  [
    74
    /* i32_gt_s */
  ]: 2 | 4 | 8 | 64,
  [
    75
    /* i32_gt_u */
  ]: 2 | 4 | 8 | 64 | 128,
  [
    76
    /* i32_le_s */
  ]: 2 | 4 | 8 | 64,
  [
    77
    /* i32_le_u */
  ]: 2 | 4 | 8 | 64 | 128,
  [
    78
    /* i32_ge_s */
  ]: 2 | 4 | 8 | 64,
  [
    79
    /* i32_ge_u */
  ]: 2 | 4 | 8 | 64 | 128,
  [
    80
    /* i64_eqz */
  ]: 1 | 4 | 8,
  [
    81
    /* i64_eq */
  ]: 2 | 4 | 8 | 64,
  [
    82
    /* i64_ne */
  ]: 2 | 4 | 8 | 64,
  [
    83
    /* i64_lt_s */
  ]: 2 | 4 | 8 | 64 | 256,
  [
    84
    /* i64_lt_u */
  ]: 2 | 4 | 8 | 64,
  [
    85
    /* i64_gt_s */
  ]: 2 | 4 | 8 | 64 | 256,
  [
    86
    /* i64_gt_u */
  ]: 2 | 4 | 8 | 64,
  [
    87
    /* i64_le_s */
  ]: 2 | 4 | 8 | 64 | 256,
  [
    88
    /* i64_le_u */
  ]: 2 | 4 | 8 | 64,
  [
    89
    /* i64_ge_s */
  ]: 2 | 4 | 8 | 64 | 256,
  [
    90
    /* i64_ge_u */
  ]: 2 | 4 | 8 | 64,
  [
    91
    /* f32_eq */
  ]: 2 | 4 | 8 | 64,
  [
    92
    /* f32_ne */
  ]: 2 | 4 | 8 | 64,
  [
    93
    /* f32_lt */
  ]: 2 | 4 | 8 | 64,
  [
    94
    /* f32_gt */
  ]: 2 | 4 | 8 | 64,
  [
    95
    /* f32_le */
  ]: 2 | 4 | 8 | 64,
  [
    96
    /* f32_ge */
  ]: 2 | 4 | 8 | 64,
  [
    97
    /* f64_eq */
  ]: 2 | 4 | 8 | 64,
  [
    98
    /* f64_ne */
  ]: 2 | 4 | 8 | 64,
  [
    99
    /* f64_lt */
  ]: 2 | 4 | 8 | 64,
  [
    100
    /* f64_gt */
  ]: 2 | 4 | 8 | 64,
  [
    101
    /* f64_le */
  ]: 2 | 4 | 8 | 64,
  [
    102
    /* f64_ge */
  ]: 2 | 4 | 8 | 64,
  [
    103
    /* i32_clz */
  ]: 1 | 4 | 8,
  [
    104
    /* i32_ctz */
  ]: 1 | 4 | 8,
  [
    105
    /* i32_popcnt */
  ]: 1 | 4 | 8,
  [
    106
    /* i32_add */
  ]: 2 | 4 | 8,
  [
    107
    /* i32_sub */
  ]: 2 | 4 | 8,
  [
    108
    /* i32_mul */
  ]: 2 | 4 | 8,
  [
    109
    /* i32_div_s */
  ]: 2 | 4 | 8,
  [
    110
    /* i32_div_u */
  ]: 2 | 4 | 8 | 128,
  [
    111
    /* i32_rem_s */
  ]: 2 | 4 | 8,
  [
    112
    /* i32_rem_u */
  ]: 2 | 4 | 8 | 128,
  [
    113
    /* i32_and */
  ]: 2 | 4 | 8,
  [
    114
    /* i32_or */
  ]: 2 | 4 | 8,
  [
    115
    /* i32_xor */
  ]: 2 | 4 | 8,
  [
    116
    /* i32_shl */
  ]: 2 | 4 | 8,
  [
    117
    /* i32_shr_s */
  ]: 2 | 4 | 8,
  [
    118
    /* i32_shr_u */
  ]: 2 | 4 | 8,
  [
    119
    /* i32_rotl */
  ]: 2 | 4 | 8,
  [
    120
    /* i32_rotr */
  ]: 2 | 4 | 8,
  [
    121
    /* i64_clz */
  ]: 1 | 4 | 8,
  [
    122
    /* i64_ctz */
  ]: 1 | 4 | 8,
  [
    123
    /* i64_popcnt */
  ]: 1 | 4 | 8,
  [
    124
    /* i64_add */
  ]: 2 | 4 | 8,
  [
    125
    /* i64_sub */
  ]: 2 | 4 | 8,
  [
    126
    /* i64_mul */
  ]: 2 | 4 | 8,
  [
    127
    /* i64_div_s */
  ]: 2 | 4 | 8 | 256,
  [
    128
    /* i64_div_u */
  ]: 2 | 4 | 8,
  [
    129
    /* i64_rem_s */
  ]: 2 | 4 | 8 | 256,
  [
    130
    /* i64_rem_u */
  ]: 2 | 4 | 8,
  [
    131
    /* i64_and */
  ]: 2 | 4 | 8,
  [
    132
    /* i64_or */
  ]: 2 | 4 | 8,
  [
    133
    /* i64_xor */
  ]: 2 | 4 | 8,
  [
    134
    /* i64_shl */
  ]: 2 | 4 | 8 | 1024,
  [
    135
    /* i64_shr_s */
  ]: 2 | 4 | 8 | 1024,
  [
    136
    /* i64_shr_u */
  ]: 2 | 4 | 8 | 1024,
  [
    137
    /* i64_rotl */
  ]: 2 | 4 | 8 | 1024,
  [
    138
    /* i64_rotr */
  ]: 2 | 4 | 8 | 1024,
  [
    139
    /* f32_abs */
  ]: 1 | 4 | 8,
  [
    140
    /* f32_neg */
  ]: 1 | 4 | 8,
  [
    141
    /* f32_ceil */
  ]: 1 | 4 | 8,
  [
    142
    /* f32_floor */
  ]: 1 | 4 | 8,
  [
    143
    /* f32_trunc */
  ]: 1 | 4 | 8,
  [
    144
    /* f32_nearest */
  ]: 1 | 4 | 8,
  [
    145
    /* f32_sqrt */
  ]: 1 | 4 | 8,
  [
    146
    /* f32_add */
  ]: 2 | 4 | 8,
  [
    147
    /* f32_sub */
  ]: 2 | 4 | 8,
  [
    148
    /* f32_mul */
  ]: 2 | 4 | 8,
  [
    149
    /* f32_div */
  ]: 2 | 4 | 8,
  [
    150
    /* f32_min */
  ]: 2 | 4 | 8,
  [
    151
    /* f32_max */
  ]: 2 | 4 | 8,
  [
    152
    /* f32_copysign */
  ]: 2 | 4 | 8,
  [
    153
    /* f64_abs */
  ]: 1 | 4 | 8,
  [
    154
    /* f64_neg */
  ]: 1 | 4 | 8,
  [
    155
    /* f64_ceil */
  ]: 1 | 4 | 8,
  [
    156
    /* f64_floor */
  ]: 1 | 4 | 8,
  [
    157
    /* f64_trunc */
  ]: 1 | 4 | 8,
  [
    158
    /* f64_nearest */
  ]: 1 | 4 | 8,
  [
    159
    /* f64_sqrt */
  ]: 1 | 4 | 8,
  [
    160
    /* f64_add */
  ]: 2 | 4 | 8,
  [
    161
    /* f64_sub */
  ]: 2 | 4 | 8,
  [
    162
    /* f64_mul */
  ]: 2 | 4 | 8,
  [
    163
    /* f64_div */
  ]: 2 | 4 | 8,
  [
    164
    /* f64_min */
  ]: 2 | 4 | 8,
  [
    165
    /* f64_max */
  ]: 2 | 4 | 8,
  [
    166
    /* f64_copysign */
  ]: 2 | 4 | 8,
  [
    167
    /* i32_wrap_i64 */
  ]: 1 | 4 | 8,
  [
    168
    /* i32_trunc_f32_s */
  ]: 1 | 4 | 8,
  [
    169
    /* i32_trunc_f32_u */
  ]: 1 | 4 | 8,
  [
    170
    /* i32_trunc_f64_s */
  ]: 1 | 4 | 8,
  [
    171
    /* i32_trunc_f64_u */
  ]: 1 | 4 | 8,
  [
    172
    /* i64_extend_i32_s */
  ]: 1 | 4 | 8,
  [
    173
    /* i64_extend_i32_u */
  ]: 1 | 4 | 8,
  [
    174
    /* i64_trunc_f32_s */
  ]: 1 | 4 | 8,
  [
    175
    /* i64_trunc_f32_u */
  ]: 1 | 4 | 8,
  [
    176
    /* i64_trunc_f64_s */
  ]: 1 | 4 | 8,
  [
    177
    /* i64_trunc_f64_u */
  ]: 1 | 4 | 8,
  [
    178
    /* f32_convert_i32_s */
  ]: 1 | 4 | 512 | 8,
  [
    179
    /* f32_convert_i32_u */
  ]: 1 | 4 | 512 | 8 | 128,
  [
    180
    /* f32_convert_i64_s */
  ]: 1 | 4 | 8 | 256,
  [
    181
    /* f32_convert_i64_u */
  ]: 1 | 4 | 8,
  [
    182
    /* f32_demote_f64 */
  ]: 1 | 4 | 512 | 8,
  [
    183
    /* f64_convert_i32_s */
  ]: 1 | 4 | 512 | 8,
  [
    184
    /* f64_convert_i32_u */
  ]: 1 | 4 | 512 | 8 | 128,
  [
    185
    /* f64_convert_i64_s */
  ]: 1 | 4 | 8 | 256,
  [
    186
    /* f64_convert_i64_u */
  ]: 1 | 4 | 8,
  [
    187
    /* f64_promote_f32 */
  ]: 1 | 4 | 512 | 8,
  [
    188
    /* i32_reinterpret_f32 */
  ]: 1 | 4 | 8,
  [
    189
    /* i64_reinterpret_f64 */
  ]: 1 | 4 | 8,
  [
    190
    /* f32_reinterpret_i32 */
  ]: 1 | 4 | 8,
  [
    191
    /* f64_reinterpret_i64 */
  ]: 1 | 4 | 8,
  [
    192
    /* i32_extend8_s */
  ]: 1 | 4 | 8,
  [
    193
    /* i32_extend16_s */
  ]: 1 | 4 | 8,
  [
    194
    /* i64_extend8_s */
  ]: 1 | 4 | 8,
  [
    195
    /* i64_extend16_s */
  ]: 1 | 4 | 8,
  [
    196
    /* i64_extend32_s */
  ]: 1 | 4 | 8,
  [
    209
    /* ref_is_null */
  ]: 1 | 4 | 8 | 64,
  [
    210
    /* ref_func */
  ]: 4 | 16 | 8,
  [
    64512
    /* i32_trunc_sat_f32_s */
  ]: 1 | 4 | 8,
  [
    64513
    /* i32_trunc_sat_f32_u */
  ]: 1 | 4 | 8,
  [
    64514
    /* i32_trunc_sat_f64_s */
  ]: 1 | 4 | 8,
  [
    64515
    /* i32_trunc_sat_f64_u */
  ]: 1 | 4 | 8,
  [
    64516
    /* i64_trunc_sat_f32_s */
  ]: 1 | 4 | 8,
  [
    64517
    /* i64_trunc_sat_f32_u */
  ]: 1 | 4 | 8,
  [
    64518
    /* i64_trunc_sat_f64_s */
  ]: 1 | 4 | 8,
  [
    64519
    /* i64_trunc_sat_f64_u */
  ]: 1 | 4 | 8,
  [
    64521
    /* data_drop */
  ]: 16 | 8,
  [
    64525
    /* elem_drop */
  ]: 16 | 8,
  [
    64527
    /* table_grow */
  ]: 2 | 4 | 16 | 8,
  [
    64528
    /* table_size */
  ]: 4 | 16 | 8,
  [
    64529
    /* table_fill */
  ]: 3 | 16 | 8
  /* Simple */
};
var astBufferSingleton = new Int32Array(1 << 16);
var optimizeNode = compileOptimizations();
var compileCode = (funcs, funcTypes, createLazyFunc, tables, dataSegments, elementSegments, globals, context, wasm, codeIndex, funcIndex) => {
  const readU32LEB = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[bytesPtr++];
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value >>> 0;
  };
  const readI32LEB = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[bytesPtr++];
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return shift < 32 && byte & 64 ? value | ~0 << shift : value;
  };
  const readI64LEB = () => {
    let value = 0n;
    let shift = 0n;
    let byte;
    do {
      byte = bytes[bytesPtr++];
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    } while (byte & 128);
    return shift < 64 && byte & 64 ? value | ~0n << shift : value;
  };
  const readBlockType = () => {
    const byte = bytes[bytesPtr];
    if (byte === 64) {
      bytesPtr++;
      return [0, 0];
    }
    if (byte & 64) {
      bytesPtr++;
      return [0, 1];
    }
    const typeIndex = readU32LEB();
    const [argTypes2, returnTypes2] = typeSection[typeIndex];
    return [argTypes2.length, returnTypes2.length];
  };
  const ast = astBufferSingleton;
  const astPtrs = [];
  let astNextPtr = 0;
  const constants = [];
  let stackLimit = 0;
  const stackSlotName = (stackSlot) => {
    while (stackLimit < stackSlot) decls.push("s" + ++stackLimit);
    return "s" + stackSlot;
  };
  const usedTables = {};
  const tableName = (index) => {
    if (!usedTables[index]) {
      decls.push(`t${index}=t[${index}]`);
      usedTables[index] = true;
    }
    return "t" + index;
  };
  const load8 = (field, addr, offset, index) => {
    return `c.${field + index}[${emit(addr)}${offset ? "+" + offset : ""}]`;
  };
  const store8 = (field, addr, offset, index, value) => {
    return `c.${field + index}[${emit(addr)}${offset ? "+" + offset : ""}]=${value}`;
  };
  const load = (get, addr, offset, index) => {
    return `c.${/* @__KEY__ */ "h" + index}.get${get}(${emit(addr)}${offset ? "+" + offset : ""},1)`;
  };
  const store = (set, addr, offset, index, value) => {
    return `c.${/* @__KEY__ */ "h" + index}.set${set}(${emit(addr)}${offset ? "+" + offset : ""},${value},1)`;
  };
  const emit = (ptr) => {
    return ptr < 0 ? stackSlotName(-ptr) : `(${emitUnwrapped(ptr)})`;
  };
  const emitUnwrapped = (ptr) => {
    const node = ast[ptr];
    const op = node & 65535;
    switch (op) {
      case 16:
      case 18: {
        const childCount = node >> 16 & 255;
        const funcIndex2 = ast[ptr + childCount + 1];
        const [argTypes2, returnTypes2] = funcTypes[funcIndex2];
        const args = [];
        for (let i = 1; i <= childCount; i++) args.push(emit(ast[ptr + i]));
        const fn = `f[${funcIndex2}]`;
        const code = op === 18 ? `l.${/* @__KEY__ */ "G"}(this,${fn},[${args}])` : `${fn}(${args})`;
        if (returnTypes2.length < 2) return code;
        const slot = ast[ptr + childCount + 2];
        const returns = [];
        for (let i = 0; i < returnTypes2.length; i++) returns.push(stackSlotName(slot + i));
        return `[${returns}]=${code}`;
      }
      case 17:
      case 19: {
        const childCount = node >> 16 & 255;
        const tableIndex = ast[ptr + childCount + 2];
        const typeIndex = ast[ptr + childCount + 3];
        const [argTypes2, returnTypes2] = typeSection[typeIndex];
        const args = [];
        const funcIndex2 = emit(ast[ptr + 1]);
        for (let i = 1; i <= childCount; i++) args.push(emit(ast[ptr + i + 1]));
        const fn = `${tableName(tableIndex)}[${funcIndex2}].${/* @__KEY__ */ "u"}`;
        const code = op === 19 ? `l.${/* @__KEY__ */ "G"}(this,${fn},[${args}])` : `${fn}(${args})`;
        if (returnTypes2.length < 2) return code;
        const slot = ast[ptr + childCount + 4];
        const returns = [];
        for (let i = 0; i < returnTypes2.length; i++) returns.push(stackSlotName(slot + i));
        return `[${returns}]=${code}`;
      }
      case 27:
      case 28:
        return `${emit(ast[ptr + 1])}?${emit(ast[ptr + 2])}:${emit(ast[ptr + 3])}`;
      case 32:
        return names[ast[ptr + 1]];
      case 33:
      case 34:
        return `${names[ast[ptr + 2]]}=${emit(ast[ptr + 1])}`;
      case 35:
        return `g[${ast[ptr + 1]}]`;
      case 36:
        return `g[${ast[ptr + 2]}]=${emit(ast[ptr + 1])}`;
      case 37:
        return tableName(ast[ptr + 2]) + `[${emit(ast[ptr + 1])}]`;
      case 38:
        return tableName(ast[ptr + 3]) + `[${emit(ast[ptr + 1])}]=${emit(ast[ptr + 2])}`;
      case 40:
        return load("Int32", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 245:
        return load("Uint32", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 41:
        return load("BigUint64", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 246:
        return load("BigInt64", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 42:
        return load("Float32", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 43:
        return load("Float64", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 44:
        return load8(/* @__KEY__ */ "k", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 45:
        return load8(/* @__KEY__ */ "e", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 46:
        return load("Int16", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 47:
        return load("Uint16", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3]);
      case 48:
        return `BigInt(${load8(/* @__KEY__ */ "k", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3])})&0xFFFFFFFFFFFFFFFFn`;
      case 49:
        return `BigInt(${load8(/* @__KEY__ */ "e", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3])})`;
      case 50:
        return `BigInt(${load("Int16", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3])})&0xFFFFFFFFFFFFFFFFn`;
      case 51:
        return `BigInt(${load("Uint16", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3])})`;
      case 52:
        return `BigInt(${load("Int32", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3])})&0xFFFFFFFFFFFFFFFFn`;
      case 53:
        return `BigInt(${load("Uint32", ast[ptr + 1], ast[ptr + 2], ast[ptr + 3])})`;
      case 54:
        return store("Int32", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], emit(ast[ptr + 2]));
      case 55:
        return store("BigUint64", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], emit(ast[ptr + 2]));
      case 56:
        return store("Float32", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], emit(ast[ptr + 2]));
      case 57:
        return store("Float64", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], emit(ast[ptr + 2]));
      case 58:
        return store8(/* @__KEY__ */ "e", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], emit(ast[ptr + 2]));
      case 59:
        return store("Int16", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], emit(ast[ptr + 2]));
      case 60:
        return store8(/* @__KEY__ */ "e", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], `Number(${emit(ast[ptr + 2])}&255n)`);
      case 61:
        return store("Int16", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], `Number(${emit(ast[ptr + 2])}&65535n)`);
      case 62:
        return store("Int32", ast[ptr + 1], ast[ptr + 3], ast[ptr + 4], `Number(${emit(ast[ptr + 2])}&0xFFFFFFFFn)`);
      case 63:
        return `c.${/* @__KEY__ */ "K" + ast[ptr + 1]}.${/* @__KEY__ */ "n"}`;
      case 64:
        return `c.${/* @__KEY__ */ "K" + ast[ptr + 2]}.${/* @__KEY__ */ "L"}(${emit(ast[ptr + 1])})`;
      case 65:
        return ast[ptr + 1] + "";
      case 66:
        return (constants[ast[ptr + 1]] & 0xFFFFFFFFFFFFFFFFn) + "n";
      case 67: {
        const value = dataView.getFloat32(ast[ptr + 1], true);
        return Object.is(value, -0) ? "-0" : value + "";
      }
      case 68: {
        const value = dataView.getFloat64(ast[ptr + 1], true);
        return Object.is(value, -0) ? "-0" : value + "";
      }
      case 240:
        return emit(ast[ptr + 1]);
      case 241:
        return `!${emit(ast[ptr + 1])}`;
      case 242:
        return `${emit(ast[ptr + 1])}?1:0`;
      case 243:
        return `${emit(ast[ptr + 1])}>>>0`;
      case 244:
        return `l.${/* @__KEY__ */ "p"}(${emit(ast[ptr + 1])})`;
      case 69:
      case 80:
        return `${emit(ast[ptr + 1])}?0:1`;
      case 70:
      case 81:
      case 91:
      case 97:
        return `${emit(ast[ptr + 1])}===${emit(ast[ptr + 2])}`;
      case 71:
      case 82:
      case 92:
      case 98:
        return `${emit(ast[ptr + 1])}!==${emit(ast[ptr + 2])}`;
      case 72:
      case 73:
      case 83:
      case 84:
      case 93:
      case 99:
        return `${emit(ast[ptr + 1])}<${emit(ast[ptr + 2])}`;
      case 74:
      case 75:
      case 85:
      case 86:
      case 94:
      case 100:
        return `${emit(ast[ptr + 1])}>${emit(ast[ptr + 2])}`;
      case 76:
      case 77:
      case 87:
      case 88:
      case 95:
      case 101:
        return `${emit(ast[ptr + 1])}<=${emit(ast[ptr + 2])}`;
      case 78:
      case 79:
      case 89:
      case 90:
      case 96:
      case 102:
        return `${emit(ast[ptr + 1])}>=${emit(ast[ptr + 2])}`;
      case 103:
        return `Math.clz32(${emit(ast[ptr + 1])})`;
      case 104:
        return `l.${/* @__KEY__ */ "W"}(${emit(ast[ptr + 1])})`;
      case 105:
        return `l.${/* @__KEY__ */ "X"}(${emit(ast[ptr + 1])})`;
      case 106:
        return `${emit(ast[ptr + 1])}+${emit(ast[ptr + 2])}|0`;
      case 107:
        return `${emit(ast[ptr + 1])}-${emit(ast[ptr + 2])}|0`;
      case 108:
        return `Math.imul(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 110:
      case 109:
        return `${emit(ast[ptr + 1])}/${emit(ast[ptr + 2])}|0`;
      case 112:
      case 111:
        return `${emit(ast[ptr + 1])}%${emit(ast[ptr + 2])}|0`;
      case 113:
        return `${emit(ast[ptr + 1])}&${emit(ast[ptr + 2])}`;
      case 114:
        return `${emit(ast[ptr + 1])}|${emit(ast[ptr + 2])}`;
      case 115:
        return `${emit(ast[ptr + 1])}^${emit(ast[ptr + 2])}`;
      case 116:
        return `${emit(ast[ptr + 1])}<<${emit(ast[ptr + 2])}`;
      case 117:
        return `${emit(ast[ptr + 1])}>>${emit(ast[ptr + 2])}`;
      case 118:
        return `${emit(ast[ptr + 1])}>>>${emit(ast[ptr + 2])}|0`;
      case 119:
        return `l.${/* @__KEY__ */ "S"}(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 120:
        return `l.${/* @__KEY__ */ "T"}(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 121:
        return `l.${/* @__KEY__ */ "Y"}(${emit(ast[ptr + 1])})`;
      case 122:
        return `l.${/* @__KEY__ */ "Z"}(${emit(ast[ptr + 1])})`;
      case 123:
        return `l.${/* @__KEY__ */ "_"}(${emit(ast[ptr + 1])})`;
      case 124:
        return `(${emit(ast[ptr + 1])}+${emit(ast[ptr + 2])})&0xFFFFFFFFFFFFFFFFn`;
      case 125:
        return `(${emit(ast[ptr + 1])}-${emit(ast[ptr + 2])})&0xFFFFFFFFFFFFFFFFn`;
      case 126:
        return `(${emit(ast[ptr + 1])}*${emit(ast[ptr + 2])})&0xFFFFFFFFFFFFFFFFn`;
      case 127:
        return `${emit(ast[ptr + 1])}/${emit(ast[ptr + 2])}&0xFFFFFFFFFFFFFFFFn`;
      case 128:
        return `${emit(ast[ptr + 1])}/${emit(ast[ptr + 2])}`;
      case 129:
        return `${emit(ast[ptr + 1])}%${emit(ast[ptr + 2])}&0xFFFFFFFFFFFFFFFFn`;
      case 130:
        return `${emit(ast[ptr + 1])}%${emit(ast[ptr + 2])}`;
      case 131:
        return `${emit(ast[ptr + 1])}&${emit(ast[ptr + 2])}`;
      case 132:
        return `${emit(ast[ptr + 1])}|${emit(ast[ptr + 2])}`;
      case 133:
        return `${emit(ast[ptr + 1])}^${emit(ast[ptr + 2])}`;
      case 134:
        return `${emit(ast[ptr + 1])}<<${emit(ast[ptr + 2])}&0xFFFFFFFFFFFFFFFFn`;
      case 135:
        return `l.${/* @__KEY__ */ "p"}(${emit(ast[ptr + 1])})>>${emit(ast[ptr + 2])}&0xFFFFFFFFFFFFFFFFn`;
      case 136:
        return `${emit(ast[ptr + 1])}>>${emit(ast[ptr + 2])}`;
      case 137:
        return `l.${/* @__KEY__ */ "U"}(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 138:
        return `l.${/* @__KEY__ */ "V"}(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 139:
      case 153:
        return `Math.abs(${emit(ast[ptr + 1])})`;
      case 140:
      case 154:
        return `-${emit(ast[ptr + 1])}`;
      case 141:
      case 155:
        return `Math.ceil(${emit(ast[ptr + 1])})`;
      case 142:
      case 156:
        return `Math.floor(${emit(ast[ptr + 1])})`;
      case 143:
      case 157:
        return `Math.trunc(${emit(ast[ptr + 1])})`;
      case 144:
      case 158:
        return `Math.round(${emit(ast[ptr + 1])})`;
      case 145:
      case 159:
        return `Math.sqrt(${emit(ast[ptr + 1])})`;
      case 146:
      case 160:
        return `${emit(ast[ptr + 1])}+${emit(ast[ptr + 2])}`;
      case 147:
      case 161:
        return `${emit(ast[ptr + 1])}-${emit(ast[ptr + 2])}`;
      case 148:
      case 162:
        return `${emit(ast[ptr + 1])}*${emit(ast[ptr + 2])}`;
      case 149:
      case 163:
        return `${emit(ast[ptr + 1])}/${emit(ast[ptr + 2])}`;
      case 150:
      case 164:
        return `Math.min(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 151:
      case 165:
        return `Math.max(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 152:
      case 166:
        return `l.${/* @__KEY__ */ "N"}(${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 167:
        return `Number(${emit(ast[ptr + 1])}&0xFFFFFFFFn)|0`;
      case 168:
      case 169:
      case 170:
      case 171:
        return `Math.trunc(${emit(ast[ptr + 1])})|0`;
      case 172:
        return `BigInt(${emit(ast[ptr + 1])})`;
      case 173:
        return `BigInt(${emit(ast[ptr + 1])}>>>0)`;
      case 174:
      case 175:
      case 176:
      case 177:
        return `BigInt(Math.trunc(${emit(ast[ptr + 1])}))&0xFFFFFFFFFFFFFFFFn`;
      case 180:
      case 181:
      case 186:
      case 185:
        return `Number(${emit(ast[ptr + 1])})`;
      case 188:
        return `l.${/* @__KEY__ */ "O"}(${emit(ast[ptr + 1])})`;
      case 189:
        return `l.${/* @__KEY__ */ "Q"}(${emit(ast[ptr + 1])})`;
      case 190:
        return `l.${/* @__KEY__ */ "P"}(${emit(ast[ptr + 1])})`;
      case 191:
        return `l.${/* @__KEY__ */ "R"}(${emit(ast[ptr + 1])})`;
      case 192:
        return `${emit(ast[ptr + 1])}<<24>>24`;
      case 193:
        return `${emit(ast[ptr + 1])}<<16>>16`;
      case 194:
        return `l.${/* @__KEY__ */ "$"}(${emit(ast[ptr + 1])})`;
      case 195:
        return `l.${/* @__KEY__ */ "aa"}(${emit(ast[ptr + 1])})`;
      case 196:
        return `l.${/* @__KEY__ */ "ba"}(${emit(ast[ptr + 1])})`;
      case 208:
        return "null";
      case 209:
        return `${emit(ast[ptr + 1])}===null`;
      case 210:
        return `F(${ast[ptr + 1]})`;
      case 64512:
        return `l.${/* @__KEY__ */ "z"}(${emit(ast[ptr + 1])})`;
      case 64513:
        return `l.${/* @__KEY__ */ "A"}(${emit(ast[ptr + 1])})`;
      case 64514:
        return `l.${/* @__KEY__ */ "z"}(${emit(ast[ptr + 1])})`;
      case 64515:
        return `l.${/* @__KEY__ */ "A"}(${emit(ast[ptr + 1])})`;
      case 64516:
        return `l.${/* @__KEY__ */ "B"}(${emit(ast[ptr + 1])})`;
      case 64517:
        return `l.${/* @__KEY__ */ "C"}(${emit(ast[ptr + 1])})`;
      case 64518:
        return `l.${/* @__KEY__ */ "B"}(${emit(ast[ptr + 1])})`;
      case 64519:
        return `l.${/* @__KEY__ */ "C"}(${emit(ast[ptr + 1])})`;
      case 64520:
        return `l.${/* @__KEY__ */ "D"}(d[${ast[ptr + 4]}],c.${/* @__KEY__ */ "e" + ast[ptr + 5]},${emit(ast[ptr + 1])},${emit(ast[ptr + 2])},${emit(ast[ptr + 3])})`;
      case 64521:
        return `d[${ast[ptr + 1]}]=new Uint8Array`;
      case 64522:
        return `l.${/* @__KEY__ */ "D"}(c.${/* @__KEY__ */ "e" + ast[ptr + 4]},c.${/* @__KEY__ */ "e" + ast[ptr + 5]},${emit(ast[ptr + 1])},${emit(ast[ptr + 2])},${emit(ast[ptr + 3])})`;
      case 64523:
        return `c.${/* @__KEY__ */ "e" + ast[ptr + 4]}.fill(${emit(ast[ptr + 1])},T=${emit(ast[ptr + 2])},T+${emit(ast[ptr + 3])})`;
      case 64524:
        return `l.${/* @__KEY__ */ "E"}(${tableName(ast[ptr + 4])},e[${ast[ptr + 5]}],${emit(ast[ptr + 1])},${emit(ast[ptr + 2])},${emit(ast[ptr + 3])})`;
      case 64525:
        return `e[${ast[ptr + 1]}]=[]`;
      case 64526:
        return `l.${/* @__KEY__ */ "E"}(${tableName(ast[ptr + 4])},${tableName(ast[ptr + 5])},${emit(ast[ptr + 1])},${emit(ast[ptr + 2])},${emit(ast[ptr + 3])})`;
      case 64527:
        return `l.${/* @__KEY__ */ "F"}(${tableName(ast[ptr + 3])},${emit(ast[ptr + 1])},${emit(ast[ptr + 2])})`;
      case 64528:
        return tableName(ast[ptr + 1]) + ".length";
      case 64529:
        return `l.${/* @__KEY__ */ "da"}(${tableName(ast[ptr + 4])},${emit(ast[ptr + 1])},${emit(ast[ptr + 2])},${emit(ast[ptr + 3])})`;
      default:
        throw "Internal error";
    }
  };
  const allocateNode = (node, length) => {
    const ptr = astNextPtr;
    ast[ptr] = node;
    astNextPtr += length;
    return ptr;
  };
  const pushUnary = (op, stackSlot = stackTop) => {
    astPtrs.push(astNextPtr);
    ast[astNextPtr++] = op | 1 << 16 | stackSlot << 24;
    ast[astNextPtr++] = -stackSlot;
  };
  const handleReturn = () => {
    finalizeBasicBlock();
    jump(0);
    blocks[blocks.length - 1].c = true;
  };
  const finalizeBasicBlock = (popStackTop = false) => {
    const parts = [];
    let i = astPtrs.length - 1;
    const optimizeChildrenAndSelf = (ptr2) => {
      const node = ast[ptr2];
      const op = node & 65535;
      const childCount = node >> 16 & 255;
      const usesTypedArrays = op >= 40 && op <= 62 || op >= 64520 && op <= 64523;
      for (let j = childCount - 1; i >= 0 && j >= 0; j--) {
        const stackSlot = -ast[ptr2 + j + 1];
        let didSkip = false;
        for (let k = i; k >= 0; k--) {
          const prevPtr = astPtrs[k];
          if (prevPtr === null) continue;
          const prevNode = ast[prevPtr];
          const prevOp = prevNode & 65535;
          if (usesTypedArrays && // The only exception we make is for nodes that are trivially safe,
          // which include terminal nodes without any children that don't
          // have side effects. The common ones are special-cased below.
          (prevOp < 65 || prevOp > 66) && prevOp != 32) {
            break;
          }
          if (prevNode >>> 24 === stackSlot) {
            astPtrs[k] = null;
            if (!didSkip) i = k - 1;
            ast[ptr2 + j + 1] = optimizeChildrenAndSelf(prevPtr);
            break;
          }
          if (prevOp !== 243 && prevOp !== 244) break;
          didSkip = true;
        }
      }
      return optimizeNode(ast, constants, allocateNode, ptr2);
    };
    let ptr;
    while (i >= 0) {
      const index = i--;
      if ((ptr = astPtrs[index]) !== null) {
        astPtrs[index] = optimizeChildrenAndSelf(ptr);
      }
    }
    let result;
    i = astPtrs.length - 1;
    if (popStackTop) {
      if (i >= 0 && (ptr = astPtrs[i]) !== null && ast[ptr] >>> 24 === stackTop) {
        result = emitUnwrapped(ptr);
        i--;
      } else {
        result = "s" + stackTop;
      }
      stackTop--;
    }
    while (i >= 0) {
      if ((ptr = astPtrs[i--]) !== null) {
        const stackSlot = ast[ptr] >>> 24;
        parts.push(`${stackSlot ? stackSlotName(stackSlot) + "=" : ""}${emitUnwrapped(ptr)};`);
      }
    }
    body += parts.reverse().join("");
    constants.length = 0;
    astPtrs.length = 0;
    astNextPtr = 0;
    return result;
  };
  const {
    ia: bytes,
    h: dataView,
    H: codeSection,
    I: functionSection,
    pa: nameSection,
    J: typeSection
  } = wasm;
  const [argTypes, returnTypes] = typeSection[functionSection[codeIndex]];
  const [locals, codeStart, codeEnd] = codeSection[codeIndex];
  const names = [];
  const argCount = argTypes.length;
  for (let i = 0; i < argCount; i++) {
    names.push("a" + i);
  }
  const decls = ["L", "T"];
  for (const [count, type] of locals) {
    for (let i = 0; i < count; i++) {
      const name2 = "l" + decls.length;
      names.push(name2);
      decls.push(name2 + (type === 126 ? "=0n" : "=0"));
    }
  }
  const blockDepthLimit = 256;
  const pushBlock = (kind) => {
    const isBelowLimit = blocks.length < blockDepthLimit;
    if (isBelowLimit) {
      body += `b${blocks.length}:`;
    } else if (blocks.length === blockDepthLimit) {
      body += `L=1;b${blocks.length}:for(;;){switch(L){case 1:`;
      nextLabel = 2;
    }
    const labelBreak = isBelowLimit ? -1 : nextLabel++;
    const labelContinueOrElse = isBelowLimit ? -1 : kind !== 0 ? nextLabel++ : 0;
    const [argCount2, returnCount] = readBlockType();
    blocks.push({
      l: argCount2,
      c: false,
      m: kind,
      x: labelBreak,
      j: labelContinueOrElse,
      i: stackTop - argCount2,
      g: returnCount
    });
    return labelContinueOrElse;
  };
  const jump = (index = blocks.length - readU32LEB() - 1) => {
    if (blocks[blocks.length - 1].c) return;
    const block = blocks[index];
    if (!index) {
      if (block.g === 1) {
        body += `return s${stackTop};`;
      } else if (block.g > 1) {
        const values = [];
        for (let i = block.g - 1; i >= 0; i--) values.push("s" + (stackTop - i));
        body += `return[${values}];`;
      } else {
        body += `return;`;
      }
    } else if (block.m === 1) {
      if (stackTop > block.i + block.l) {
        for (let i = 1; i <= block.l; i++) {
          body += `s${block.i + i}=s${stackTop - block.l + i};`;
        }
      }
      body += index < blockDepthLimit ? `continue b${index};` : `L=${block.j};continue;`;
    } else {
      if (stackTop > block.i + block.g) {
        for (let i = 1; i <= block.g; i++) {
          body += `s${block.i + i}=s${stackTop - block.g + i};`;
        }
      }
      body += index <= blockDepthLimit ? `break b${index};` : `L=${block.x};continue;`;
    }
  };
  const blocks = [{
    l: 0,
    c: false,
    m: 0,
    x: -1,
    j: -1,
    i: 0,
    g: returnTypes.length
  }];
  const handleSimpleOp = (op) => {
    const flags = metaTable[op] | 0;
    if (!(flags & 8)) return false;
    if (flags & 8) {
      if (!blocks[blocks.length - 1].c) {
        const childCount = flags & 3;
        if (flags & 1024) {
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = 66 | stackTop + 1 << 24;
          ast[astNextPtr++] = constants.length;
          constants.push(63n);
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = 131 | 2 << 16 | stackTop << 24;
          ast[astNextPtr++] = -stackTop;
          ast[astNextPtr++] = -(stackTop + 1);
        }
        stackTop -= childCount;
        if (flags & (128 | 256)) {
          for (let i = 0; i < childCount; i++) {
            pushUnary(flags & 128 ? 243 : 244, stackTop + i + 1);
          }
        }
        if (!(flags & 512)) {
          let memoryIndex = 0;
          if (flags & 32 && bytes[bytesPtr++] & 64) memoryIndex = readU32LEB();
          astPtrs.push(astNextPtr);
          if (flags & 4) op |= stackTop + 1 << 24;
          ast[astNextPtr++] = op | childCount << 16;
          for (let i = 1; i <= childCount; i++) ast[astNextPtr++] = -(stackTop + i);
          if (flags & 16) ast[astNextPtr++] = readU32LEB();
          if (flags & 32) ast[astNextPtr++] = memoryIndex;
        }
        if (flags & 4) stackTop++;
        if (flags & 64) pushUnary(
          242
          /* BOOL_TO_INT */
        );
      } else {
        if (flags & 32 && bytes[bytesPtr++] & 64) readU32LEB();
        if (flags & 16) readU32LEB();
      }
    }
    return true;
  };
  let stackTop = 0;
  let bytesPtr = codeStart;
  let nextLabel = 0;
  let body = "b0:{";
  while (bytesPtr < codeEnd) {
    let op = bytes[bytesPtr++];
    if (handleSimpleOp(op)) {
      continue;
    }
    switch (op) {
      case 0: {
        const block = blocks[blocks.length - 1];
        finalizeBasicBlock();
        if (!block.c) {
          body += '"unreachable"();';
          block.c = true;
        }
        break;
      }
      case 2:
        finalizeBasicBlock();
        if (pushBlock(
          0
          /* Normal */
        ) < 0) body += "{";
        break;
      case 3: {
        finalizeBasicBlock();
        const label = pushBlock(
          1
          /* Loop */
        );
        body += label < 0 ? "for(;;){" : `case ${label}:`;
        break;
      }
      case 4: {
        if (!blocks[blocks.length - 1].c) {
          pushUnary(
            blocks.length < blockDepthLimit ? 240 : 241
            /* BOOL_NOT */
          );
        }
        const test = finalizeBasicBlock(true);
        const label = pushBlock(
          2
          /* IfElse */
        );
        body += label < 0 ? `if(${test}){` : `if(${test}){L=${label};continue}`;
        break;
      }
      case 5: {
        finalizeBasicBlock();
        const index = blocks.length - 1, block = blocks[index];
        jump(index);
        body += index < blockDepthLimit ? "}else{" : `case ${block.j}:`;
        block.m = 0;
        stackTop = block.i + block.l;
        block.c = false;
        break;
      }
      case 11: {
        finalizeBasicBlock();
        const index = blocks.length - 1, block = blocks[index];
        if (block.m !== 2) block.j = 0;
        block.m = 0;
        jump(index);
        if (index < blockDepthLimit) {
          body += `}`;
        } else {
          if (block.j) body += `case ${block.j}:`;
          body += `case ${block.x}:`;
          if (index == blockDepthLimit) body += `}break}`;
        }
        stackTop = block.i + block.g;
        blocks.pop();
        break;
      }
      case 12:
        finalizeBasicBlock();
        jump();
        blocks[blocks.length - 1].c = true;
        break;
      case 13: {
        if (!blocks[blocks.length - 1].c) pushUnary(
          240
          /* BOOL */
        );
        const test = finalizeBasicBlock(true);
        body += `if(${test}){`;
        jump();
        body += "}";
        break;
      }
      case 14: {
        const test = finalizeBasicBlock(true);
        body += `switch(${test}){`;
        for (let i = 0, tableCount = readU32LEB(); i < tableCount; i++) {
          body += `case ${i}:`;
          jump();
        }
        body += "default:";
        jump();
        body += "}";
        blocks[blocks.length - 1].c = true;
        break;
      }
      case 15:
        handleReturn();
        break;
      case 16:
      case 18: {
        const needsReturn = op === 18;
        const funcIndex2 = readU32LEB();
        if (!blocks[blocks.length - 1].c) {
          const [argTypes2, returnTypes2] = funcTypes[funcIndex2];
          stackTop -= argTypes2.length;
          astPtrs.push(astNextPtr);
          if (returnTypes2.length === 1) op |= stackTop + 1 << 24;
          ast[astNextPtr++] = op | argTypes2.length << 16;
          for (let i = 1; i <= argTypes2.length; i++) ast[astNextPtr++] = -(stackTop + i);
          ast[astNextPtr++] = funcIndex2;
          if (returnTypes2.length > 1) ast[astNextPtr++] = stackTop + 1;
          stackTop += returnTypes2.length;
        }
        if (needsReturn) handleReturn();
        break;
      }
      case 17:
      case 19: {
        const needsReturn = op === 19;
        const typeIndex = readU32LEB();
        const tableIndex = readU32LEB();
        if (!blocks[blocks.length - 1].c) {
          const [argTypes2, returnTypes2] = typeSection[typeIndex];
          stackTop -= argTypes2.length + 1;
          astPtrs.push(astNextPtr);
          if (returnTypes2.length === 1) op |= stackTop + 1 << 24;
          ast[astNextPtr++] = op | argTypes2.length << 16;
          ast[astNextPtr++] = -(stackTop + argTypes2.length + 1);
          for (let i = 1; i <= argTypes2.length; i++) ast[astNextPtr++] = -(stackTop + i);
          ast[astNextPtr++] = tableIndex;
          ast[astNextPtr++] = typeIndex;
          if (returnTypes2.length > 1) ast[astNextPtr++] = stackTop + 1;
          stackTop += returnTypes2.length;
        }
        if (needsReturn) handleReturn();
        break;
      }
      case 27:
      case 28: {
        if (op === 28) {
          const count = readU32LEB();
          if (count !== 1) throw Error("Unsupported select type count " + count);
          bytesPtr++;
        }
        if (!blocks[blocks.length - 1].c) {
          pushUnary(
            240
            /* BOOL */
          );
          stackTop -= 2;
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = op | 3 << 16 | stackTop << 24;
          ast[astNextPtr++] = -(stackTop + 2);
          ast[astNextPtr++] = -stackTop;
          ast[astNextPtr++] = -(stackTop + 1);
        }
        break;
      }
      case 65:
        if (!blocks[blocks.length - 1].c) {
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = op | ++stackTop << 24;
          ast[astNextPtr++] = readI32LEB();
        } else {
          readI32LEB();
        }
        break;
      case 66:
        if (!blocks[blocks.length - 1].c) {
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = op | ++stackTop << 24;
          ast[astNextPtr++] = constants.length;
          constants.push(readI64LEB());
        } else {
          readI64LEB();
        }
        break;
      case 67:
        if (!blocks[blocks.length - 1].c) {
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = op | ++stackTop << 24;
          ast[astNextPtr++] = bytesPtr;
        }
        bytesPtr += 4;
        break;
      case 68:
        if (!blocks[blocks.length - 1].c) {
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = op | ++stackTop << 24;
          ast[astNextPtr++] = bytesPtr;
        }
        bytesPtr += 8;
        break;
      case 208:
        bytesPtr++;
        if (!blocks[blocks.length - 1].c) {
          astPtrs.push(astNextPtr);
          ast[astNextPtr++] = op | ++stackTop << 24;
        }
        break;
      case 252:
        op = 64512 | bytes[bytesPtr++];
        if (handleSimpleOp(op)) {
          continue;
        }
        switch (op) {
          case 64520: {
            const dataIndex = readU32LEB();
            const destinationIndex = readU32LEB();
            if (!blocks[blocks.length - 1].c) {
              stackTop -= 2;
              astPtrs.push(astNextPtr);
              ast[astNextPtr++] = op | 3 << 16 | stackTop << 24;
              ast[astNextPtr++] = -stackTop;
              ast[astNextPtr++] = -(stackTop + 1);
              ast[astNextPtr++] = -(stackTop + 2);
              ast[astNextPtr++] = dataIndex;
              ast[astNextPtr++] = destinationIndex;
            }
            break;
          }
          case 64522: {
            const destinationIndex = readU32LEB();
            const sourceIndex = readU32LEB();
            if (!blocks[blocks.length - 1].c) {
              stackTop -= 2;
              astPtrs.push(astNextPtr);
              ast[astNextPtr++] = op | 3 << 16 | stackTop << 24;
              ast[astNextPtr++] = -stackTop;
              ast[astNextPtr++] = -(stackTop + 1);
              ast[astNextPtr++] = -(stackTop + 2);
              ast[astNextPtr++] = sourceIndex;
              ast[astNextPtr++] = destinationIndex;
            }
            break;
          }
          case 64523: {
            const destinationIndex = readU32LEB();
            if (!blocks[blocks.length - 1].c) {
              stackTop -= 2;
              astPtrs.push(astNextPtr);
              ast[astNextPtr++] = op | 3 << 16 | stackTop << 24;
              ast[astNextPtr++] = -(stackTop + 1);
              ast[astNextPtr++] = -stackTop;
              ast[astNextPtr++] = -(stackTop + 2);
              ast[astNextPtr++] = destinationIndex;
            }
            break;
          }
          case 64524: {
            const elementIndex = readU32LEB();
            const tableIndex = readU32LEB();
            if (!blocks[blocks.length - 1].c) {
              stackTop -= 2;
              astPtrs.push(astNextPtr);
              ast[astNextPtr++] = op | 3 << 16 | stackTop << 24;
              ast[astNextPtr++] = -stackTop;
              ast[astNextPtr++] = -(stackTop + 1);
              ast[astNextPtr++] = -(stackTop + 2);
              ast[astNextPtr++] = tableIndex;
              ast[astNextPtr++] = elementIndex;
            }
            break;
          }
          case 64526: {
            const destination = readU32LEB();
            const source = readU32LEB();
            if (!blocks[blocks.length - 1].c) {
              stackTop -= 2;
              astPtrs.push(astNextPtr);
              ast[astNextPtr++] = op | 3 << 16 | stackTop << 24;
              ast[astNextPtr++] = -stackTop;
              ast[astNextPtr++] = -(stackTop + 1);
              ast[astNextPtr++] = -(stackTop + 2);
              ast[astNextPtr++] = destination;
              ast[astNextPtr++] = source;
            }
            break;
          }
          default:
            throw Error("Unsupported instruction: 0xFC " + formatHexByte(op & 255));
        }
        break;
      default:
        throw Error("Unsupported instruction: " + formatHexByte(op));
    }
  }
  if (stackLimit > 255) throw Error("Deep stacks are not supported");
  const name = JSON.stringify("wasm:" + (nameSection.get(funcIndex) || `function[${codeIndex}]`));
  const js = `return{${name}(${names.slice(0, argCount)}){var ${decls};${body}}}[${name}]`;
  return new Function("f", "F", "c", "t", "d", "e", "g", "l", js)(
    funcs,
    createLazyFunc,
    context,
    tables,
    dataSegments,
    elementSegments,
    globals,
    library
  );
};
var Global = class {
  valueOf() {
    return this.value;
  }
};
var compileImportFunc = (funcType, value) => {
  const [argTypes, returnTypes] = funcType;
  const argNames = [];
  const argExprs = [];
  for (let i = 0; i < argTypes.length; i++) {
    argNames.push("a" + i);
    argExprs.push(castToJS("a" + i, argTypes[i]));
  }
  let result = `f(${argExprs})`;
  if (returnTypes.length === 1) {
    result = "return " + castToWASM(result, returnTypes[0]);
  } else if (returnTypes.length > 1) {
    result = `let r=${result};`;
    for (let i = 0; i < returnTypes.length; i++) result += `r[${i}]=${castToWASM(`r[${i}]`, returnTypes[i])};`;
    result += "return r";
  }
  return new Function("f", "l", `return(${argNames})=>{${result}}`)(value, library);
};
var Instance = class {
  constructor(module2, importObject) {
    const wasm = moduleMap.get(module2);
    const {
      H: codeSection,
      ja: dataSection,
      ka: elementSection,
      la: exportSection,
      I: functionSection,
      ma: globalSection,
      na: importSection,
      oa: memorySection,
      qa: startSection,
      ra: tableSection,
      J: typeSection
    } = wasm;
    const exports2 = this.exports = /* @__PURE__ */ Object.create(null);
    const memories = [];
    const funcs = [];
    const funcTypes = [];
    const globals = [];
    const globalTypes = [];
    const lazyFuncs = {};
    const tables = [];
    const createLazyFunc = (index) => {
      const obj = lazyFuncs[index] || (lazyFuncs[index] = {
        ua: index,
        fa: funcTypes[index],
        t: null,
        u: (...args) => {
          const result = funcs[index](...args);
          obj.u = funcs[index];
          return result;
        }
      });
      return obj;
    };
    for (const tuple of importSection) {
      const [module22, name, desc, payload] = tuple;
      const value = importObject[module22][name];
      if (desc === 0) {
        const funcType = typeSection[payload];
        const index = funcs.length;
        funcs.push((...args) => {
          return (funcs[index] = compileImportFunc(funcType, value))(...args);
        });
        funcTypes.push(funcType);
      } else if (desc === 1) {
        tables.push(tableRegistry.get(value));
      } else if (desc === 2) {
        memories.push(memoryRegistry.get(value));
      } else if (desc === 3) {
        globals.push(liveCastToWASM(value, payload));
        globalTypes.push(payload);
      } else {
        throw Error(`Unsupported import type ${formatHexByte(desc)} for "${module22}"."${name}"`);
      }
    }
    const context = {};
    for (const [initial, maximum] of memorySection) {
      memories.push(memoryRegistry.get(new Memory({ initial, maximum: initial > maximum ? initial : maximum })));
    }
    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const patch = () => {
        context[/* @__KEY__ */ "e" + i] = memory.e;
        context[/* @__KEY__ */ "k" + i] = memory.k;
        context[/* @__KEY__ */ "h" + i] = memory.h;
      };
      context[/* @__KEY__ */ "K" + i] = memory;
      memory.M.push(patch);
      patch();
    }
    for (const [type, mutable, initializer] of globalSection) {
      globals.push(initializer(globals, createLazyFunc));
      globalTypes.push(type);
    }
    const dataSegments = [];
    for (let [index, initializer, data] of dataSection) {
      if (initializer !== null) {
        context[/* @__KEY__ */ "e" + index].set(data, initializer(globals));
        data = new Uint8Array();
      }
      dataSegments.push(data);
    }
    for (let i = 0; i < codeSection.length; i++) {
      const index = funcs.length;
      funcTypes.push(typeSection[functionSection[i]]);
      funcs.push((...args) => {
        return (funcs[index] = compileCode(
          funcs,
          funcTypes,
          createLazyFunc,
          tables,
          dataSegments,
          elementSegments,
          globals,
          context,
          wasm,
          i,
          index
        ))(...args);
      });
    }
    const elementSegments = [];
    for (const [type, initial, maximum] of tableSection) {
      if (type !== 112 && type !== 111) throw Error("Unsupported element type: " + formatHexByte(type));
      tables.push(tableRegistry.get(new Table({
        element: type === 111 ? "externref" : "anyfunc",
        initial,
        maximum: initial > maximum ? initial : maximum
      })));
    }
    for (let [tableIndex, initializer, indices] of elementSection) {
      const segment = [];
      for (const index of indices) segment.push(index === null ? null : createLazyFunc(index));
      elementSegments.push(segment);
      if (tableIndex !== null && initializer !== null) {
        const table = tables[tableIndex];
        let offset = initializer(globals);
        for (const value of segment) table[offset++] = value;
      }
    }
    for (const [name, desc, index] of exportSection) {
      if (desc === 0) {
        exports2[name] = library.s(createLazyFunc(index));
      } else if (desc === 1) {
        exports2[name] = tables[index].y;
      } else if (desc === 2) {
        exports2[name] = memories[index].y;
      } else if (desc === 3) {
        const value = new Global();
        const type = globalTypes[index];
        Object.defineProperty(value, "value", {
          get: () => globals[index],
          set: (x) => {
            globals[index] = liveCastToWASM(x, type);
          }
        });
        exports2[name] = value;
      } else {
        throw Error(`Unsupported export type ${formatHexByte(desc)} for "${name}"`);
      }
    }
    if (startSection >= 0) funcs[startSection]();
  }
};
var memoryRegistry = /* @__PURE__ */ new WeakMap();
var clampPageCount = (x) => Math.max(-1, Math.min(x, 65535)) | 0;
var Memory = class {
  constructor({ initial, maximum }) {
    initial = clampPageCount(initial);
    maximum = clampPageCount(maximum ?? Infinity);
    if (initial < 0 || initial > maximum) throw RangeError();
    const initialBuffer = new ArrayBuffer(initial << 16);
    const internal = {
      y: this,
      o: initialBuffer,
      e: new Uint8Array(initialBuffer),
      k: new Int8Array(initialBuffer),
      h: new DataView(initialBuffer),
      n: initial,
      sa: maximum,
      M: [],
      L(pageDelta) {
        const oldPageCount = this.n;
        const oldBytes = this.e;
        pageDelta = clampPageCount(pageDelta);
        if (pageDelta < 0 || this.n + pageDelta > this.sa) return -1;
        if (!pageDelta) return oldPageCount;
        const newBuffer = new ArrayBuffer((this.n += pageDelta) << 16);
        const newBytes = new Uint8Array(newBuffer);
        newBytes.set(oldBytes);
        try {
          structuredClone(this.o, { transfer: [this.o] });
        } catch {
        }
        this.o = newBuffer;
        this.e = newBytes;
        this.k = new Int8Array(newBuffer);
        this.h = new DataView(newBuffer);
        for (const patch of this.M) patch();
        return oldPageCount;
      }
    };
    memoryRegistry.set(this, internal);
    Object.defineProperty(this, "buffer", {
      get: () => internal.o
    });
    this.grow = (pageDelta) => {
      const pageCount = internal.L(pageDelta);
      if (pageCount < 0) throw RangeError();
      return pageCount;
    };
  }
};
var tableRegistry = /* @__PURE__ */ new WeakMap();
var Table = class {
  constructor({ element, initial, maximum }) {
    const isAnyFunc = element == "anyfunc";
    const internal = [];
    if (!isAnyFunc && element !== "externref") throw TypeError();
    internal.y = this;
    internal.ca = Math.min(4294967295, maximum ?? Infinity);
    internal.length = initial;
    for (let i = 0; i < initial; i++) internal[i] = null;
    tableRegistry.set(this, internal);
    Object.defineProperty(this, "length", {
      get: () => internal.length
    });
    this.get = (i) => {
      i >>>= 0;
      if (i >= internal.length) throw RangeError();
      return isAnyFunc ? library.s(internal[i]) : internal[i];
    };
    this.set = (i, value) => {
      i >>>= 0;
      if (i >= internal.length) throw RangeError();
      internal[i] = isAnyFunc ? library.r(value) : value;
    };
    this.grow = (delta, value) => {
      const oldLength = library.F(internal, isAnyFunc ? library.r(value) : value, delta);
      if (oldLength < 0) throw RangeError();
      return oldLength;
    };
  }
};
var compile = async (input) => {
  return new Module(input);
};
var compileStreaming = async (source) => {
  return new Module(await (await source).arrayBuffer());
};
var instantiate = async (input, importObject) => {
  if (input instanceof Module) return new Instance(input, importObject);
  const module2 = new Module(input);
  return { module: module2, instance: new Instance(module2, importObject) };
};
var instantiateStreaming = async (source, importObject) => {
  const module2 = new Module(await (await source).arrayBuffer());
  return { module: module2, instance: new Instance(module2, importObject) };
};
var validate = (input) => {
  if (!ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)) {
    throw TypeError("Invalid buffer source");
  }
  try {
    new Module(input);
    return true;
  } catch {
    return false;
  }
};
var wasmAPI = {
  Global,
  Instance,
  compile,
  compileStreaming,
  instantiate,
  instantiateStreaming,
  validate,
  Memory,
  Module,
  Table,
  // This cast ignores the lack of a call signature without "new", which we don't support
  CompileError
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WebAssembly
});
