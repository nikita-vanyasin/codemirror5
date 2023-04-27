// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/5/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("aql", function(config) {
  var indentUnit = config.indentUnit;
  var curPunc;

  // ops and keywords taken from ArangoDB UI code:
  // https://github.com/arangodb/arangodb/blob/devel/js/apps/system/_admin/aardvark/APP/react/public/assets/src/mode-aql.js
  function wordRegexp(words) {
    return new RegExp("^(?:" + words + ")$", "i");
  }
  var ops = wordRegexp(
      "to_bool|to_number|to_string|to_array|to_list|is_null|is_bool|is_number|is_string|is_array|is_list|is_object|is_document|is_datestring|" +
      "typename|json_stringify|json_parse|concat|concat_separator|char_length|lower|upper|substring|left|right|trim|reverse|contains|" +
      "log|log2|log10|exp|exp2|sin|cos|tan|asin|acos|atan|atan2|radians|degrees|pi|regex_test|regex_replace|" +
      "like|floor|ceil|round|abs|rand|sqrt|pow|length|count|min|max|average|avg|sum|product|median|variance_population|variance_sample|variance|" +
      "bit_and|bit_or|bit_xor|bit_negate|bit_test|bit_popcount|bit_shift_left|bit_shift_right|bit_construct|bit_deconstruct|bit_to_string|bit_from_string|" +
      "first|last|unique|outersection|interleave|in_range|jaccard|matches|merge|merge_recursive|has|attributes|values|unset|unset_recursive|keep|" +
      "near|within|within_rectangle|is_in_polygon|distance|fulltext|stddev_sample|stddev_population|stddev|" +
      "slice|nth|position|contains_array|translate|zip|call|apply|push|append|pop|shift|unshift|remove_value|remove_values|" +
      "remove_nth|replace_nth|date_now|date_timestamp|date_iso8601|date_dayofweek|date_year|date_month|date_day|date_hour|" +
      "date_minute|date_second|date_millisecond|date_dayofyear|date_isoweek|date_leapyear|date_quarter|date_days_in_month|date_trunc|date_round|" +
      "date_add|date_subtract|date_diff|date_compare|date_format|date_utctolocal|date_localtoutc|date_timezone|date_timezones|" +
      "fail|passthru|v8|sleep|schema_get|schema_validate|call_greenspun|version|noopt|noeval|not_null|" +
      "first_list|first_document|parse_identifier|current_user|current_database|collection_count|pregel_result|" +
      "collections|document|decode_rev|range|union|union_distinct|minus|intersection|flatten|is_same_collection|check_document|" +
      "ltrim|rtrim|find_first|find_last|split|substitute|ipv4_to_number|ipv4_from_number|is_ipv4|md5|sha1|sha512|crc32|fnv64|hash|random_token|to_base64|" +
      "to_hex|encode_uri_component|soundex|assert|warn|is_key|sorted|sorted_unique|count_distinct|count_unique|" +
      "levenshtein_distance|levenshtein_match|regex_matches|regex_split|ngram_match|ngram_similarity|ngram_positional_similarity|uuid|" +
      "tokens|exists|starts_with|phrase|min_match|boost|analyzer|" +
      "geo_point|geo_multipoint|geo_polygon|geo_multipolygon|geo_linestring|geo_multilinestring|geo_contains|geo_intersects|" +
      "geo_equals|geo_distance|geo_area|geo_in_range"
  );

  var keywords = wordRegexp(
    "for|return|filter|search|sort|limit|let|collect|asc|desc|in|into|insert|update|remove|replace|upsert|options|with|and|or|not|distinct|graph|shortest_path|outbound|inbound|any|all|none|aggregate|like|k_shortest_paths|k_paths|prune|window" +
    "|" +
    "search|keep|to|prune|options"
  );
  var operatorChars = /[*+\-<>=&|\^\/!\?]/;
  var PN_CHARS = "[A-Za-z_\\-0-9]";
  var PREFIX_START = new RegExp("[A-Za-z]");
  var PREFIX_REMAINDER = new RegExp("((" + PN_CHARS + "|\\.)*(" + PN_CHARS + "))?:");

  function tokenComment(stream, state) {
    var maybeEnd = false, ch;
    while (ch = stream.next()) {
      if (ch == "/" && maybeEnd) {
        state.tokenize = null;
        break;
      }
      maybeEnd = (ch == "*");
    }
    return "comment";
  }

  function tokenBase(stream, state) {
    var ch = stream.next();
    curPunc = null;
    if (ch == "<" && !stream.match(/^[\s\u00a0=]/, false)) {
      stream.match(/^[^\s\u00a0>]*>?/);
      return "atom";
    }
    else if (ch == "\"" || ch == "'" || ch == "`" || ch == "´") {
      state.tokenize = tokenLiteral(ch);
      return state.tokenize(stream, state);
    }
    else if (/[{}\(\),\.;\[\]]/.test(ch)) {
      curPunc = ch;
      return "bracket";
    }
    else if (ch == "/") {
      if (stream.eat("*")) {
        state.tokenize = tokenComment;
        return state.tokenize(stream, state);
      }
      if (stream.eat("/")) {
        stream.skipToEnd();
        return "comment";
      }
    }
    else if (operatorChars.test(ch)) {
      return "operator";
    }
    else if (ch == ":") {
      eatPnLocal(stream);
      return "atom";
    }
    else if (ch == "@") {
      stream.eatWhile(/[a-z\d\-]/i);
      return "meta";
    }
    else if (PREFIX_START.test(ch) && stream.match(PREFIX_REMAINDER)) {
        eatPnLocal(stream);
        return "atom";
    }
    stream.eatWhile(/[_\w\d]/);
    var word = stream.current();
    if (ops.test(word))
      return "builtin";
    else if (keywords.test(word))
      return "keyword";
    else
      return "variable";
  }

  function eatPnLocal(stream) {
    stream.match(/(\.(?=[\w_\-\\%])|[:\w_-]|\\[-\\_~.!$&'()*+,;=/?#@%]|%[a-f\d][a-f\d])+/i);
  }

  function tokenLiteral(quote) {
    return function(stream, state) {
      var escaped = false, ch;
      while ((ch = stream.next()) != null) {
        if (ch == quote && !escaped) {
          state.tokenize = tokenBase;
          break;
        }
        escaped = !escaped && ch == "\\";
      }
      return "string";
    };
  }

  function pushContext(state, type, col) {
    state.context = {prev: state.context, indent: state.indent, col: col, type: type};
  }
  function popContext(state) {
    state.indent = state.context.indent;
    state.context = state.context.prev;
  }

  return {
    startState: function() {
      return {tokenize: tokenBase,
              context: null,
              indent: 0,
              col: 0};
    },

    token: function(stream, state) {
      if (stream.sol()) {
        if (state.context && state.context.align == null) state.context.align = false;
        state.indent = stream.indentation();
      }
      if (stream.eatSpace()) return null;
      var style = (state.tokenize || tokenBase)(stream, state);

      if (style != "comment" && state.context && state.context.align == null && state.context.type != "pattern") {
        state.context.align = true;
      }

      if (curPunc == "(") pushContext(state, ")", stream.column());
      else if (curPunc == "[") pushContext(state, "]", stream.column());
      else if (curPunc == "{") pushContext(state, "}", stream.column());
      else if (/[\]\}\)]/.test(curPunc)) {
        while (state.context && state.context.type == "pattern") popContext(state);
        if (state.context && curPunc == state.context.type) {
          popContext(state);
          if (curPunc == "}" && state.context && state.context.type == "pattern")
            popContext(state);
        }
      }
      else if (curPunc == "." && state.context && state.context.type == "pattern") popContext(state);
      else if (/atom|string|variable/.test(style) && state.context) {
        if (/[\}\]]/.test(state.context.type))
          pushContext(state, "pattern", stream.column());
        else if (state.context.type == "pattern" && !state.context.align) {
          state.context.align = true;
          state.context.col = stream.column();
        }
      }

      return style;
    },

    indent: function(state, textAfter) {
      var firstChar = textAfter && textAfter.charAt(0);
      var context = state.context;
      if (/[\]\}]/.test(firstChar))
        while (context && context.type == "pattern") context = context.prev;

      var closing = context && firstChar == context.type;
      if (!context)
        return 0;
      else if (context.type == "pattern")
        return context.col;
      else if (context.align)
        return context.col + (closing ? 0 : 1);
      else
        return context.indent + (closing ? 0 : indentUnit);
    },

    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    lineComment: "//"
  };
});

CodeMirror.defineMIME("text/x-aql", "aql");

});
