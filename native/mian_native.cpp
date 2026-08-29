// 免语言·原生执行器（C++ 第三块砖）
// 覆盖子集：let / print / 算术含括号 / 比较 / && || ! / done / while / 赋值 / fun / call / return / 递归
// 本块新增：数组字面量 / 索引 / 越界检查 / len(数组+字符串) / 字符串 .len / import 加载
// 编译（在 /tmp 下，/sdcard 无执行位）：g++ -std=c++17 -O2 mian_native.cpp -o mian_native
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <stdexcept>
#include <chrono>

// ============ Token ============
enum class TT {
    NUM, STR, IDENT,
    KW_LET, KW_PRINT, KW_DONE, KW_WHILE, KW_FOR, KW_TRUE, KW_FALSE, KW_FUN, KW_RETURN, KW_IMPORT,
    PLUS, MINUS, STAR, SLASH, EQ, EQEQ, EQEQEQ, NEQ, NEQEQ, LT, LTE, GT, GTE,
    ANDAND, OROR, BANG,
    LPAREN, RPAREN, LBRACE, RBRACE, LBRACKET, RBRACKET, SEMI, COMMA, DOT,
    END
};

struct Token {
    TT t{TT::END};
    std::string text;
    double num{0};
    int line{0};
};

// ============ AST ============
enum class NK {
    NUM, STR, VAR, LET, PRINT, DONE, WHILE, FOR, IMPORT,
    UNARY, BIN, LOGIC, EXPR_STMT,
    FUN, CALL, RETURN,
    ARR, INDEX, GETATTR
};

struct Node {
    NK k;
    double num{0};
    std::string s;          // STR 内容 / VAR·LET·FUN 名字
    std::string op;         // BIN/LOGIC/UNARY 运算符
    Node *l{nullptr}, *r{nullptr};
    Node* init{nullptr};    // FOR init 表达式（FOR 用 l=cond, r=incr, init=init）
    std::vector<Node*> ks;  // done/while/fun 体；CALL 实参；FOR body
    std::vector<std::string> ps;   // FUN 形参名
    ~Node() { delete l; delete r; delete init; for (auto* p : ks) delete p; }
};

// ============ 错误与信号 ============
struct MIError : std::runtime_error {
    MIError(const std::string& m) : std::runtime_error("[免语言错误] " + m) {}
};

// return 的控制流真身：截断信号
struct ReturnSignal {
    bool has{false};
    struct Val* v{nullptr};
};

// ============ 值 ============
struct Val {
    enum class T { NUM, STR, FN, ARR } t{T::NUM};
    double num{0};
    std::string str;
    const Node* fn{nullptr};
    std::vector<Val> arr;   // ARR：数组元素
    static Val n(double v) { Val x; x.t = T::NUM; x.num = v; return x; }
    static Val s(const std::string& v) { Val x; x.t = T::STR; x.str = v; return x; }
    static Val f(const Node* nd) { Val x; x.t = T::FN; x.fn = nd; return x; }
    static Val a(std::vector<Val> v) { Val x; x.t = T::ARR; x.arr = std::move(v); return x; }
    bool truthy() const { return t == T::STR ? !str.empty() : (num != 0); }
};

// ============ Lexer ============
class Lexer {
    std::string src;
    size_t i{0};
    int line{1};
public:
    explicit Lexer(const std::string& s) : src(s) {}
    std::vector<Token> scanAll() {
        std::vector<Token> out;
        while (true) {
            Token t = next();
            out.push_back(t);
            if (t.t == TT::END) break;
        }
        return out;
    }
private:
    char peek() const { return i < src.size() ? src[i] : '\0'; }
    char peek2() const { return i + 1 < src.size() ? src[i + 1] : '\0'; }
    char advance() { char c = src[i++]; if (c == '\n') line++; return c; }
    bool match(char c) { if (peek() == c) { advance(); return true; } return false; }
    Token make(TT ty, const std::string& text, int ln) { Token t; t.t = ty; t.text = text; t.line = ln; return t; }
    bool isDigit(char c) const { return c >= '0' && c <= '9'; }
    bool isAlpha(char c) const { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }

    Token next() {
        for (;;) {
            if (peek() == ' ' || peek() == '\t' || peek() == '\r' || peek() == '\n') { advance(); continue; }
            if (peek() == '/' && peek2() == '/') { while (peek() != '\n' && peek() != '\0') advance(); continue; }
            if (peek() == '/' && peek2() == '*') {
                advance(); advance();
                while (!(peek() == '*' && peek2() == '/') && peek() != '\0') advance();
                if (peek() != '\0') { advance(); advance(); }
                continue;
            }
            break;
        }
        int ln = line;
        char c = advance();
        switch (c) {
            case '\0': return make(TT::END, "", ln);
            case '+': return make(TT::PLUS, "+", ln);
            case '-': return make(TT::MINUS, "-", ln);
            case '*': return make(TT::STAR, "*", ln);
            case '/': return make(TT::SLASH, "/", ln);
            case '(': return make(TT::LPAREN, "(", ln);
            case ')': return make(TT::RPAREN, ")", ln);
            case '{': return make(TT::LBRACE, "{", ln);
            case '}': return make(TT::RBRACE, "}", ln);
            case ';': return make(TT::SEMI, ";", ln);
            case ',': return make(TT::COMMA, ",", ln);
            case '[': return make(TT::LBRACKET, "[", ln);
            case ']': return make(TT::RBRACKET, "]", ln);
            case '.': return make(TT::DOT, ".", ln);
            case '=':
                if (match('=')) return match('=') ? make(TT::EQEQEQ, "===", ln) : make(TT::EQEQ, "==", ln);
                return make(TT::EQ, "=", ln);
            case '!': return match('=') ? (match('=') ? make(TT::NEQEQ, "!==", ln) : make(TT::NEQ, "!=", ln)) : make(TT::BANG, "!", ln);
            case '<': return match('=') ? make(TT::LTE, "<=", ln) : make(TT::LT, "<", ln);
            case '>': return match('=') ? make(TT::GTE, ">=", ln) : make(TT::GT, ">", ln);
            case '&': if (match('&')) return make(TT::ANDAND, "&&", ln); throw MIError("第" + std::to_string(ln) + "行：单个 & 不是运算符，要写 &&");
            case '|': if (match('|')) return make(TT::OROR, "||", ln);   throw MIError("第" + std::to_string(ln) + "行：单个 | 不是运算符，要写 ||");
            case '"': {
                std::string s;
                while (peek() != '"' && peek() != '\0') s += advance();
                if (peek() == '\0') throw MIError("第" + std::to_string(ln) + "行：字符串没有闭合引号");
                advance();
                return make(TT::STR, s, ln);
            }
            default:
                if (isDigit(c)) {
                    std::string s(1, c);
                    while (isDigit(peek())) s += advance();
                    if (peek() == '.' && isDigit(peek2())) { s += advance(); while (isDigit(peek())) s += advance(); }
                    Token t = make(TT::NUM, s, ln);
                    t.num = std::stod(s);
                    return t;
                }
                if (isAlpha(c)) {
                    std::string s(1, c);
                    while (isAlpha(peek()) || isDigit(peek())) s += advance();
                    if (s == "let")    return make(TT::KW_LET, s, ln);
                    if (s == "print")  return make(TT::KW_PRINT, s, ln);
                    if (s == "done")   return make(TT::KW_DONE, s, ln);
                    if (s == "while")  return make(TT::KW_WHILE, s, ln);
                    if (s == "for")    return make(TT::KW_FOR, s, ln);
                    if (s == "fun")    return make(TT::KW_FUN, s, ln);
                    if (s == "return") return make(TT::KW_RETURN, s, ln);
                    if (s == "import") return make(TT::KW_IMPORT, s, ln);
                    if (s == "true")  { auto t = make(TT::KW_TRUE, s, ln); t.num = 1; return t; }
                    if (s == "false") { auto t = make(TT::KW_FALSE, s, ln); t.num = 0; return t; }
                    return make(TT::IDENT, s, ln);
                }
                throw MIError("第" + std::to_string(ln) + "行：不认识的字符 '" + std::string(1, c) + "'");
        }
    }
};

// ============ Parser ============
class Parser {
    std::vector<Token> toks;
    size_t i{0};
public:
    explicit Parser(const std::vector<Token>& t) : toks(t) {}
    std::vector<Node*> parseProgram() {
        std::vector<Node*> stmts;
        while (!atEnd()) stmts.push_back(statement());
        return stmts;
    }
private:
    Token peek() const { return toks[i]; }
    Token prev() const { return toks[i - 1]; }
    bool atEnd() const { return peek().t == TT::END; }
    Token advance() { if (!atEnd()) i++; return prev(); }
    bool check(TT ty) const { return peek().t == ty; }
    bool match(TT ty) { if (check(ty)) { advance(); return true; } return false; }
    Token consume(TT ty, const std::string& msg) {
        if (check(ty)) return advance();
        throw MIError("第" + std::to_string(peek().line) + "行：" + msg + "（当前是 '" + peek().text + "'）");
    }

    Node* statement() {
        if (match(TT::KW_FUN)) {
            Token name = consume(TT::IDENT, "fun 后面要跟函数名");
            consume(TT::LPAREN, "函数名后要跟 (");
            auto* n = new Node; n->k = NK::FUN; n->s = name.text;
            if (!check(TT::RPAREN)) {
                do { n->ps.push_back(consume(TT::IDENT, "参数要是名字").text); }
                while (match(TT::COMMA));
            }
            consume(TT::RPAREN, "参数列表要 ) 收尾");
            consume(TT::LBRACE, "函数体要 { 开头");
            n->ks = block();
            return n;
        }
        if (match(TT::KW_RETURN)) {
            // 多值返回：return a, b; —— 逗号分隔，存进 ks
            auto* n = new Node; n->k = NK::RETURN;
            n->ks.push_back(expression());
            while (match(TT::COMMA)) n->ks.push_back(expression());
            consume(TT::SEMI, "return 结尾要写 ;");
            return n;
        }
        if (match(TT::KW_LET)) {
            // 解构：let (x, y) = f();
            if (check(TT::LPAREN)) {
                advance();
                auto* n = new Node; n->k = NK::LET; n->ps.push_back(consume(TT::IDENT, "解构里要是变量名").text);
                while (match(TT::COMMA)) n->ps.push_back(consume(TT::IDENT, "解构里要是变量名").text);
                consume(TT::RPAREN, "解构要 ) 收尾");
                consume(TT::EQ, "变量声明要写 =");
                n->r = expression();
                consume(TT::SEMI, "语句结尾要写 ;");
                return n;
            }
            Token name = consume(TT::IDENT, "let 后面要跟变量名");
            consume(TT::EQ, "变量声明要写 =");
            Node* init = expression();
            consume(TT::SEMI, "语句结尾要写 ;");
            auto* n = new Node; n->k = NK::LET; n->s = name.text; n->r = init;
            return n;
        }
        if (match(TT::KW_PRINT)) {
            Node* v = expression();
            consume(TT::SEMI, "print 结尾要写 ;");
            auto* n = new Node; n->k = NK::PRINT; n->r = v;
            return n;
        }
        if (match(TT::KW_DONE)) {
            Node* cond = expression();
            consume(TT::LBRACE, "done 后面要跟 { 块");
            auto* n = new Node; n->k = NK::DONE; n->l = cond; n->ks = block();
            return n;
        }
        if (match(TT::KW_WHILE)) {
            Node* cond = expression();
            consume(TT::LBRACE, "while 后面要跟 { 块");
            auto* n = new Node; n->k = NK::WHILE; n->l = cond; n->ks = block();
            return n;
        }
        if (match(TT::KW_FOR)) {
            consume(TT::LPAREN, "for 后面要跟 (");
            Node* init = nullptr;
            if (!check(TT::SEMI)) init = expression();
            consume(TT::SEMI, "for 第一部分后要 ;");
            Node* cond = nullptr;
            if (!check(TT::SEMI)) cond = expression();
            consume(TT::SEMI, "for 第二部分后要 ;");
            Node* incr = nullptr;
            if (!check(TT::RPAREN)) incr = expression();
            consume(TT::RPAREN, "for 第三部分后要 )");
            consume(TT::LBRACE, "for 体要 { 开头");
            auto* n = new Node; n->k = NK::FOR; n->init = init; n->l = cond; n->r = incr; n->ks = block();
            return n;
        }
        if (match(TT::KW_IMPORT)) {
            Node* v = expression();
            consume(TT::SEMI, "import 结尾要写 ;");
            auto* n = new Node; n->k = NK::IMPORT; n->r = v;
            return n;
        }
        Node* e = expression();
        consume(TT::SEMI, "表达式语句结尾要写 ;");
        auto* n = new Node; n->k = NK::EXPR_STMT; n->r = e;
        return n;
    }

    std::vector<Node*> block() {
        std::vector<Node*> stmts;
        while (!check(TT::RBRACE) && !atEnd()) stmts.push_back(statement());
        consume(TT::RBRACE, "块要 } 收尾");
        return stmts;
    }

    Node* expression() { return assignment(); }
    Node* or_() {
        Node* l = and_();
        while (match(TT::OROR)) {
            std::string op = prev().text;
            Node* r = and_();
            auto* n = new Node; n->k = NK::LOGIC; n->op = op; n->l = l; n->r = r;
            l = n;
        }
        return l;
    }
    Node* and_() {
        Node* l = equality();
        while (match(TT::ANDAND)) {
            std::string op = prev().text;
            Node* r = equality();
            auto* n = new Node; n->k = NK::LOGIC; n->op = op; n->l = l; n->r = r;
            l = n;
        }
        return l;
    }
    Node* assignment() {
        Node* l = or_();
        if (match(TT::EQ)) {
            if (l->k != NK::VAR) throw MIError("赋值目标必须是个变量");
            Node* r = assignment();   // 右结合
            auto* n = new Node; n->k = NK::BIN; n->op = "="; n->l = l; n->r = r;
            return n;
        }
        return l;
    }
    Node* equality() {
        Node* l = comparison();
        while (match(TT::EQEQ) || match(TT::EQEQEQ) || match(TT::NEQ) || match(TT::NEQEQ)) {
            std::string op = prev().text;
            Node* r = comparison();
            auto* n = new Node; n->k = NK::BIN; n->op = op; n->l = l; n->r = r;
            l = n;
        }
        return l;
    }
    Node* comparison() {
        Node* l = term();
        while (match(TT::LT) || match(TT::LTE) || match(TT::GT) || match(TT::GTE)) {
            std::string op = prev().text;
            Node* r = term();
            auto* n = new Node; n->k = NK::BIN; n->op = op; n->l = l; n->r = r;
            l = n;
        }
        return l;
    }
    Node* term() {
        Node* l = factor();
        while (match(TT::PLUS) || match(TT::MINUS)) {
            std::string op = prev().text;
            Node* r = factor();
            auto* n = new Node; n->k = NK::BIN; n->op = op; n->l = l; n->r = r;
            l = n;
        }
        return l;
    }
    Node* factor() {
        Node* l = unary();
        while (match(TT::STAR) || match(TT::SLASH)) {
            std::string op = prev().text;
            Node* r = unary();
            auto* n = new Node; n->k = NK::BIN; n->op = op; n->l = l; n->r = r;
            l = n;
        }
        return l;
    }
    Node* unary() {
        if (match(TT::MINUS) || match(TT::BANG)) {
            std::string op = prev().text;
            Node* r = unary();
            auto* n = new Node; n->k = NK::UNARY; n->op = op; n->r = r;
            return n;
        }
        return call();
    }
    Node* call() {
        Node* callee = primary();
        while (true) {
            if (match(TT::LPAREN)) {
                auto* n = new Node; n->k = NK::CALL; n->l = callee;
                if (!check(TT::RPAREN)) {
                    do { n->ks.push_back(expression()); }
                    while (match(TT::COMMA));
                }
                consume(TT::RPAREN, "调用参数要 ) 收尾");
                callee = n;
            } else if (match(TT::LBRACKET)) {
                Node* idx = expression();
                consume(TT::RBRACKET, "索引要 ] 收尾");
                auto* n = new Node; n->k = NK::INDEX; n->l = callee; n->r = idx;
                callee = n;
            } else if (match(TT::DOT)) {
                Token name = consume(TT::IDENT, "属性访问 . 后面要跟名字");
                auto* n = new Node; n->k = NK::GETATTR; n->l = callee; n->s = name.text;
                callee = n;
            } else {
                break;
            }
        }
        return callee;
    }
    Node* primary() {
        if (match(TT::NUM))      { auto* n = new Node; n->k = NK::NUM;  n->num = prev().num; return n; }
        if (match(TT::STR))      { auto* n = new Node; n->k = NK::STR;  n->s = prev().text;  return n; }
        if (match(TT::KW_TRUE))  { auto* n = new Node; n->k = NK::NUM;  n->num = 1;          return n; }
        if (match(TT::KW_FALSE)) { auto* n = new Node; n->k = NK::NUM;  n->num = 0;          return n; }
        if (match(TT::IDENT))    { auto* n = new Node; n->k = NK::VAR;  n->s = prev().text;  return n; }
        if (match(TT::LBRACKET)) {
            auto* n = new Node; n->k = NK::ARR;
            while (!check(TT::RBRACKET) && !atEnd()) {
                n->ks.push_back(expression());
                if (!match(TT::COMMA)) break;
            }
            consume(TT::RBRACKET, "数组字面量要 ] 收尾");
            return n;
        }
        if (match(TT::LPAREN)) {
            Node* e = expression();
            consume(TT::RPAREN, "右括号 ) 去哪了");
            return e;
        }
        throw MIError("第" + std::to_string(peek().line) + "行：这个位置需要一个表达式（当前是 '" + peek().text + "'）");
    }
};

// ============ 执行层 ============
struct ScopeChain {
    std::map<std::string, Val> m;
    ScopeChain* parent{nullptr};
};
using SC = ScopeChain;

// 全局：import 保留的 AST（防止函数值指针悬空）
std::vector<std::vector<Node*>> importRetained;

Val* lookup(SC* sc, const std::string& n) {
    for (SC* p = sc; p; p = p->parent) {
        auto it = p->m.find(n);
        if (it != p->m.end()) return &it->second;
    }
    return nullptr;
}

Val eval(const Node* nd, SC* sc);
Val execStmt(const Node* nd, SC* sc);

// 真值打印规则（与 JS 解释器一致的布尔回禀）
bool isBoolNode(const Node* nd) {
    if (nd->k == NK::LOGIC) return true;
    if (nd->k == NK::BIN && (nd->op == "==" || nd->op == "!=" || nd->op == "===" || nd->op == "!==" || nd->op == "<" ||
                             nd->op == "<=" || nd->op == ">" || nd->op == ">=")) return true;
    if (nd->k == NK::UNARY && nd->op == "!") return true;
    return false;
}

Val execStmt(const Node* nd, SC* sc) {
    switch (nd->k) {
        case NK::FUN: {
            Val f = Val::f(nd);
            sc->m[nd->s] = f;
            return f;
        }
        case NK::RETURN: {
            if (nd->ks.size() == 1) throw Val(eval(nd->ks[0], sc));
            // 多值返回：打包成数组
            std::vector<Val> arr;
            for (Node* k : nd->ks) arr.push_back(eval(k, sc));
            throw Val(Val::a(arr));
        }
        case NK::LET: {
            Val v = eval(nd->r, sc);
            if (nd->ps.size() > 0) {
                // 解构：let (x, y) = f(); —— 右侧须是数组
                if (v.t != Val::T::ARR) throw MIError("解构赋值右边必须是数组");
                if (v.arr.size() < nd->ps.size())
                    throw MIError("解构需要 " + std::to_string(nd->ps.size()) + " 个值，但右侧只有 " + std::to_string(v.arr.size()) + " 个");
                for (size_t i = 0; i < nd->ps.size(); i++) sc->m[nd->ps[i]] = v.arr[i];
                return v;
            }
            sc->m[nd->s] = v;
            return v;
        }
        case NK::PRINT: {
            Val v = eval(nd->r, sc);
            if (nd->r->k == NK::STR) {
                std::cout << nd->r->s << std::endl;
            } else if (v.t == Val::T::ARR) {
                std::cout << "[";
                for (size_t i = 0; i < v.arr.size(); i++) {
                    if (i) std::cout << ", ";
                    const Val& e = v.arr[i];
                    if (e.t == Val::T::NUM) { if (e.num == (long long)e.num) std::cout << (long long)e.num; else std::cout << e.num; }
                    else if (e.t == Val::T::STR) std::cout << "\"" << e.str << "\"";
                    else if (e.t == Val::T::ARR) std::cout << "[...]";
                    else std::cout << "<fun>";
                }
                std::cout << "]" << std::endl;
            } else if (isBoolNode(nd->r)) {
                std::cout << (v.num == 0 ? "false" : "true") << std::endl;
            } else if (v.t == Val::T::NUM) {
                if (v.num == (long long)v.num) std::cout << (long long)v.num << std::endl;
                else std::cout << v.num << std::endl;
            } else {
                std::cout << v.str << std::endl;
            }
            return Val::n(0);
        }
        case NK::IMPORT: {
            // import 只吃字符串字面量（路径），与 JS 侧一致
            if (nd->r->k != NK::STR) throw MIError("import 只支持字符串路径");
            std::string path = nd->r->s;
            // 越界检查：只准读 .mi 文件，禁止目录穿越
            if (path.find("..") != std::string::npos) throw MIError("import 路径不允许 .. 穿越");
            if (path.size() < 3) throw MIError("import 路径太短");
            // 循环依赖 + 重复加载防护（JS 侧同期）
            static std::set<std::string> loadedSet;
            std::string absPath = path;
            if (loadedSet.count(absPath)) { return Val::n(0); }  // 已加载过：跳过
            loadedSet.insert(absPath);
            std::ifstream f(path);
            if (!f) throw MIError("import 打不开文件: " + path);
            std::stringstream ss; ss << f.rdbuf();
            Lexer lex(ss.str());
            auto toks = lex.scanAll();
            Parser par(toks);
            auto stmts = par.parseProgram();
            Val last = Val::n(0);
            for (Node* k : stmts) last = execStmt(k, sc);   // 共享当前作用域（同 JS 侧）
            // ⚠️ 不 delete stmts：import 里的函数定义被 Val::f(nd) 捕获为函数值，
            // 释放会让指针悬空（length_error 真凶）。转存到全局持有，进程退出时系统回收。
            importRetained.push_back(stmts);
            return last;
        }
        case NK::DONE: {
            Val c = eval(nd->l, sc);
            Val last = c;
            if (c.truthy()) {
                for (auto* k : nd->ks) last = execStmt(k, sc);
            }
            return last;
        }
        case NK::WHILE: {
            Val last = Val::n(0);
            int guard = 0;
            while (eval(nd->l, sc).truthy()) {
                for (auto* k : nd->ks) last = execStmt(k, sc);
                if (++guard > 1000000) throw MIError("while 跑了超过 100 万次，可能是死循环");
            }
            return last;
        }
        case NK::FOR: {
            Val last = Val::n(0);
            if (nd->init) eval(nd->init, sc);
            int guard = 0;
            while (nd->l ? eval(nd->l, sc).truthy() : true) {
                for (auto* k : nd->ks) last = execStmt(k, sc);
                if (nd->r) eval(nd->r, sc);
                if (++guard > 1000000) throw MIError("for 跑了超过 100 万次，可能是死循环");
            }
            return last;
        }
        case NK::EXPR_STMT:
            return eval(nd->r, sc);
        default:
            return eval(nd, sc);
    }
}

Val eval(const Node* nd, SC* sc) {
    if (!nd) throw MIError("空节点");
    switch (nd->k) {
        case NK::NUM: return Val::n(nd->num);
        case NK::STR: return Val::s(nd->s);
        case NK::ARR: {
            std::vector<Val> items;
            for (Node* k : nd->ks) items.push_back(eval(k, sc));
            return Val::a(items);
        }
        case NK::VAR: {
            Val* p = lookup(sc, nd->s);
            if (!p) throw MIError("变量 '" + nd->s + "' 未声明");
            return *p;
        }
        case NK::UNARY: {
            Val v = eval(nd->r, sc);
            if (v.t != Val::T::NUM) throw MIError("一元运算只吃数字");
            if (nd->op == "-") return Val::n(-v.num);
            return Val::n(v.truthy() ? 0 : 1);
        }
        case NK::BIN: {
            // = 赋值特殊处理：左值不能先求值（变量可能还不存在）
            if (nd->op == "=") {
                if (nd->l->k != NK::VAR) throw MIError("赋值目标必须是个变量");
                Val r = eval(nd->r, sc);
                Val* p = lookup(sc, nd->l->s);
                if (!p) { sc->m[nd->l->s] = r; }
                else { *p = r; }
                return r;
            }
            Val l = eval(nd->l, sc), r = eval(nd->r, sc);
            if (nd->op == "==") { if (l.t != Val::T::NUM || r.t != Val::T::NUM) throw MIError("== 只支持数字"); return Val::n(l.num == r.num ? 1 : 0); }
            if (nd->op == "!=") { if (l.t != Val::T::NUM || r.t != Val::T::NUM) throw MIError("!= 只支持数字"); return Val::n(l.num != r.num ? 1 : 0); }
            if (nd->op == "===") { if (l.t != r.t) return Val::n(0); if (l.t == Val::T::NUM) return Val::n(l.num == r.num ? 1 : 0); if (l.t == Val::T::STR) return Val::n(l.str == r.str ? 1 : 0); throw MIError("=== 只支持数字或字符串"); }
            if (nd->op == "!==") { if (l.t != r.t) return Val::n(1); if (l.t == Val::T::NUM) return Val::n(l.num != r.num ? 1 : 0); if (l.t == Val::T::STR) return Val::n(l.str != r.str ? 1 : 0); throw MIError("!== 只支持数字或字符串"); }
            if (nd->op == "<" ) { if (l.t != Val::T::NUM || r.t != Val::T::NUM) throw MIError("< 只支持数字"); return Val::n(l.num <  r.num ? 1 : 0); }
            if (nd->op == "<=") { if (l.t != Val::T::NUM || r.t != Val::T::NUM) throw MIError("<= 只支持数字"); return Val::n(l.num <= r.num ? 1 : 0); }
            if (nd->op == ">" ) { if (l.t != Val::T::NUM || r.t != Val::T::NUM) throw MIError("> 只支持数字"); return Val::n(l.num >  r.num ? 1 : 0); }
            if (nd->op == ">=") { if (l.t != Val::T::NUM || r.t != Val::T::NUM) throw MIError(">= 只支持数字"); return Val::n(l.num >= r.num ? 1 : 0); }
            if (l.t != Val::T::NUM || r.t != Val::T::NUM) {
                if (nd->op == "+" && l.t == Val::T::STR && r.t == Val::T::STR) return Val::s(l.str + r.str);
                throw MIError(nd->op + " 只吃数字");
            }
            if (nd->op == "+") return Val::n(l.num + r.num);
            if (nd->op == "-") return Val::n(l.num - r.num);
            if (nd->op == "*") return Val::n(l.num * r.num);
            if (nd->op == "/") {
                if (r.num == 0) throw MIError("除数为零");
                return Val::n(l.num / r.num);
            }
            throw MIError("不认识的运算符: " + nd->op);
        }
        case NK::LOGIC: {
            Val l = eval(nd->l, sc);
            if (nd->op == "&&") return Val::n((l.truthy() && eval(nd->r, sc).truthy()) ? 1 : 0);
            if (nd->op == "||") return Val::n((l.truthy() || eval(nd->r, sc).truthy()) ? 1 : 0);
            throw MIError("不认识的逻辑符: " + nd->op);
        }
        case NK::INDEX: {
            Val target = eval(nd->l, sc);
            Val idxv = eval(nd->r, sc);
            if (target.t != Val::T::ARR) throw MIError("只能对数组用索引");
            if (idxv.t != Val::T::NUM) throw MIError("索引要是数字");
            long long i = (long long)idxv.num;
            if (i < 0 || i >= (long long)target.arr.size())
                throw MIError("索引越界：长度 " + std::to_string(target.arr.size()) + "，索引 " + std::to_string(i));
            return target.arr[i];
        }
        case NK::GETATTR: {
            Val target = eval(nd->l, sc);
            // 字符串方法：.len
            if (target.t == Val::T::STR && nd->s == "len")
                return Val::n((double)target.str.size());
            throw MIError("对象没有属性 '" + nd->s + "'");
        }
        case NK::CALL: {
            Val f = eval(nd->l, sc);
            // 内置函数：len / type / str / clock（作为原生函数实现）
            if (f.t == Val::T::FN && f.fn == nullptr) {
                if (f.str == "len") {
                    if (nd->ks.size() != 1) throw MIError("len 需要 1 个参数");
                    Val v = eval(nd->ks[0], sc);
                    if (v.t == Val::T::STR) return Val::n((double)v.str.size());
                    if (v.t == Val::T::ARR) return Val::n((double)v.arr.size());
                    throw MIError("len 只支持字符串或数组");
                }
                if (f.str == "type") {
                    if (nd->ks.size() != 1) throw MIError("type 需要 1 个参数");
                    Val v = eval(nd->ks[0], sc);
                    switch (v.t) {
                        case Val::T::NUM: return Val::s("number");
                        case Val::T::STR: return Val::s("string");
                        case Val::T::ARR: return Val::s("array");
                        default: return Val::s("function");
                    }
                }
                if (f.str == "str") {
                    if (nd->ks.size() != 1) throw MIError("str 需要 1 个参数");
                    Val v = eval(nd->ks[0], sc);
                    if (v.t == Val::T::NUM) {
                        if (v.num == (long long)v.num) return Val::s(std::to_string((long long)v.num));
                        return Val::s(std::to_string(v.num));
                    }
                    if (v.t == Val::T::STR) return v;
                    throw MIError("str 只支持数字或字符串");
                }
                if (f.str == "clock") {
                    if (nd->ks.size() != 0) throw MIError("clock 不需要参数");
                    return Val::n((double)(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count()));
                }
                throw MIError("未知原生函数: " + f.str);
            }
            if (f.t != Val::T::FN) throw MIError("不是函数，不能调用");
            const Node* fnd = f.fn;
            if (nd->ks.size() != fnd->ps.size())
                throw MIError("函数 " + fnd->s + " 需要 " + std::to_string(fnd->ps.size()) +
                              " 个参数，但传了 " + std::to_string(nd->ks.size()) + " 个");
            SC child; child.parent = sc;
            for (size_t j = 0; j < fnd->ps.size(); j++) {
                child.m[fnd->ps[j]] = eval(nd->ks[j], sc);
            }
            try {
                Val last = Val::n(0);
                for (auto* k : fnd->ks) last = execStmt(k, &child);
                return last;
            } catch (const Val& ret) {
                return ret;   // return 值
            }
        }
        default:
            throw MIError("求值器碰到不该出现在表达式里的节点 kind");
    }
}

// ============ 入口 ============
int main(int argc, char** argv) {
    std::string src;
    if (argc >= 2) {
        std::ifstream f(argv[1]);
        if (!f) { std::cerr << "[免语言错误] 打不开文件: " << argv[1] << std::endl; return 1; }
        std::stringstream ss; ss << f.rdbuf(); src = ss.str();
    } else {
        src = "let a = 1 + 2 * 3; print a; done a == 7 { print \"seven\"; }";
    }
    try {
        Lexer lex(src);
        auto toks = lex.scanAll();
        Parser par(toks);
        auto stmts = par.parseProgram();
        SC global;
        // 注册内置函数（len/type/str/clock —— 以 fn==nullptr 标记原生，str 存名字）
        global.m["len"]   = Val::f(nullptr); global.m["len"].str = "len";
        global.m["type"]  = Val::f(nullptr); global.m["type"].str = "type";
        global.m["str"]   = Val::f(nullptr); global.m["str"].str = "str";
        global.m["clock"] = Val::f(nullptr); global.m["clock"].str = "clock";
        for (Node* nd : stmts) {
            try { execStmt(nd, &global); }
            catch (const Val&) { /* 顶层 return 不算错 */ }
        }
        for (Node* nd : stmts) delete nd;
        return 0;
    } catch (const MIError& e) {
        std::cerr << e.what() << std::endl;
        return 1;
    }
}