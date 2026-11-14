import Foundation
import Metal
#if canImport(llama)
import llama

/// Native llama.cpp (llama.xcframework, Metal) behind the node-llama-cpp API used by the desktop code
/// (see ipad/node/node-llama-cpp/index.js). Commands: llama.info / load / ctx / chat / embed / cancel / ctxFree / free.
final class LlamaBridge {
    static let shared = LlamaBridge()
    private let queue = DispatchQueue(label: "aib.llama", qos: .userInitiated)
    private var models = [Int: OpaquePointer]()
    private var contexts = [Int: (ctx: OpaquePointer, model: Int, embedding: Bool)]()
    private var cancelled = Set<Int>()
    private let cancelLock = NSLock()
    private var nextId = 1
    private var backendReady = false

    typealias Reply = (_ ok: Bool, _ result: Any?, _ error: String?) -> Void

    func handle(_ m: [String: Any], reply: @escaping Reply, partial: @escaping ([String: Any]) -> Void) {
        let cmd = m["cmd"] as? String ?? ""
        if cmd == "llama.cancel" { if let c = m["ctx"] as? Int { cancelLock.lock(); cancelled.insert(c); cancelLock.unlock() }; return }
        queue.async { [self] in
            if !backendReady { llama_backend_init(); backendReady = true }
            switch cmd {
            case "llama.info":
                let dev = MTLCreateSystemDefaultDevice()
                reply(true, ["ok": true, "gpu": dev == nil ? "cpu" : "metal", "vramTotal": Double(dev?.recommendedMaxWorkingSetSize ?? 0), "device": dev?.name ?? ""], nil)
            case "llama.load": load(m, reply)
            case "llama.ctx": makeContext(m, reply)
            case "llama.chat": chat(m, reply, partial)
            case "llama.embed": embed(m, reply)
            case "llama.ctxFree":
                if let id = m["ctx"] as? Int, let c = contexts.removeValue(forKey: id) { llama_free(c.ctx) }
                reply(true, true, nil)
            case "llama.free":
                if let id = m["model"] as? Int, let p = models.removeValue(forKey: id) {
                    for (cid, c) in contexts where c.model == id { llama_free(c.ctx); contexts.removeValue(forKey: cid) }
                    llama_model_free(p)
                }
                reply(true, true, nil)
            default: reply(false, nil, "unknown \(cmd)")
            }
        }
    }

    private func load(_ m: [String: Any], _ reply: Reply) {
        guard let path = m["path"] as? String, FileManager.default.fileExists(atPath: path) else { reply(false, nil, "模型文件不存在"); return }
        var p = llama_model_default_params()
        let gl = (m["gpuLayers"] as? Int) ?? -1
        p.n_gpu_layers = gl < 0 ? 999 : Int32(gl)
        guard let model = llama_model_load_from_file(path, p) else { reply(false, nil, "llama.cpp 无法加载该模型（格式不受支持或内存不足）"); return }
        let id = nextId; nextId += 1
        models[id] = model
        var desc = [CChar](repeating: 0, count: 256)
        _ = llama_model_desc(model, &desc, 256)
        reply(true, ["model": id, "nCtxTrain": Int(llama_model_n_ctx_train(model)), "nEmbd": Int(llama_model_n_embd(model)), "desc": String(cString: desc), "size": Double(llama_model_size(model))], nil)
    }

    private func makeContext(_ m: [String: Any], _ reply: Reply) {
        guard let mid = m["model"] as? Int, let model = models[mid] else { reply(false, nil, "模型未加载"); return }
        let embedding = (m["embedding"] as? Bool) ?? false
        var cp = llama_context_default_params()
        cp.n_ctx = UInt32(max(512, (m["nCtx"] as? Int) ?? 4096))
        cp.n_batch = embedding ? cp.n_ctx : 512
        cp.n_ubatch = embedding ? cp.n_ctx : 512
        let cores = ProcessInfo.processInfo.activeProcessorCount
        cp.n_threads = Int32(max(2, cores - 2)); cp.n_threads_batch = Int32(max(2, cores - 2))
        cp.embeddings = embedding
        guard let ctx = llama_init_from_model(model, cp) else { reply(false, nil, "无法创建上下文（内存不足？请减小上下文长度）"); return }
        let id = nextId; nextId += 1
        contexts[id] = (ctx, mid, embedding)
        reply(true, ["ctx": id, "nCtx": Int(llama_n_ctx(ctx))], nil)
    }

    private func tokenize(_ vocab: OpaquePointer, _ text: String, special: Bool) -> [llama_token] {
        let utf8 = Array(text.utf8CString)
        let n = Int32(utf8.count - 1)
        var toks = [llama_token](repeating: 0, count: Int(n) + 8)
        var got = llama_tokenize(vocab, utf8, n, &toks, Int32(toks.count), special, true)
        if got < 0 { toks = [llama_token](repeating: 0, count: Int(-got)); got = llama_tokenize(vocab, utf8, n, &toks, Int32(toks.count), special, true) }
        return Array(toks.prefix(Int(max(0, got))))
    }

    private func piece(_ vocab: OpaquePointer, _ t: llama_token) -> [UInt8] {
        var buf = [CChar](repeating: 0, count: 64)
        var n = llama_token_to_piece(vocab, t, &buf, Int32(buf.count), 0, false)
        if n < 0 { buf = [CChar](repeating: 0, count: Int(-n)); n = llama_token_to_piece(vocab, t, &buf, Int32(buf.count), 0, false) }
        return buf.prefix(Int(max(0, n))).map { UInt8(bitPattern: $0) }
    }

    private func formatChat(_ model: OpaquePointer, _ msgs: [[String: Any]]) -> String {
        let roles = msgs.map { ($0["role"] as? String) ?? "user" }, contents = msgs.map { ($0["content"] as? String) ?? "" }
        let cRoles = roles.map { strdup($0) }, cContents = contents.map { strdup($0) }
        defer { cRoles.forEach { free($0) }; cContents.forEach { free($0) } }
        var chat = (0..<msgs.count).map { llama_chat_message(role: UnsafePointer(cRoles[$0]), content: UnsafePointer(cContents[$0])) }
        let tmpl = llama_model_chat_template(model, nil)
        var cap = Int32(max(4096, contents.reduce(0) { $0 + $1.utf8.count } * 2 + 1024))
        var buf = [CChar](repeating: 0, count: Int(cap))
        var n = llama_chat_apply_template(tmpl, &chat, chat.count, true, &buf, cap)
        if n > cap { cap = n + 1; buf = [CChar](repeating: 0, count: Int(cap)); n = llama_chat_apply_template(tmpl, &chat, chat.count, true, &buf, cap) }
        if n > 0 { return String(decoding: buf.prefix(Int(n)).map { UInt8(bitPattern: $0) }, as: UTF8.self) }
        // template not supported by llama.cpp's built-in list: ChatML
        return zip(roles, contents).map { "<|im_start|>\($0)\n\($1)<|im_end|>\n" }.joined() + "<|im_start|>assistant\n"
    }

    private func isCancelled(_ id: Int) -> Bool { cancelLock.lock(); defer { cancelLock.unlock() }; return cancelled.contains(id) }

    private func chat(_ m: [String: Any], _ reply: Reply, _ partial: ([String: Any]) -> Void) {
        guard let cid = m["ctx"] as? Int, let c = contexts[cid], let model = models[c.model], let vocab = llama_model_get_vocab(model) else { reply(false, nil, "上下文不存在"); return }
        cancelLock.lock(); cancelled.remove(cid); cancelLock.unlock()
        let ctx = c.ctx
        let msgs = (m["messages"] as? [[String: Any]]) ?? []
        let maxTokens = max(1, (m["maxTokens"] as? Int) ?? 1500)
        let nCtx = Int(llama_n_ctx(ctx))
        var prompt = tokenize(vocab, formatChat(model, msgs), special: true)
        let room = max(256, nCtx - min(maxTokens, nCtx / 2))
        if prompt.count > room { prompt = Array(prompt.suffix(room)) } // keep the most recent part of a long conversation
        llama_memory_clear(llama_get_memory(ctx), true)
        let nBatch = Int(llama_n_batch(ctx))
        var i = 0
        while i < prompt.count {
            let end = min(prompt.count, i + nBatch)
            var chunk = Array(prompt[i..<end])
            let rc = chunk.withUnsafeMutableBufferPointer { llama_decode(ctx, llama_batch_get_one($0.baseAddress, Int32($0.count))) }
            if rc != 0 { reply(false, nil, "llama_decode 失败（\(rc)）"); return }
            if isCancelled(cid) { reply(true, ["text": ""], nil); return }
            i = end
        }
        let chain = llama_sampler_chain_init(llama_sampler_chain_default_params())!
        defer { llama_sampler_free(chain) }
        if let g = m["grammar"] as? String, !g.isEmpty, let gs = llama_sampler_init_grammar(vocab, g, "root") { llama_sampler_chain_add(chain, gs) }
        let temp = (m["temperature"] as? Double) ?? 0.3
        if temp <= 0.01 { llama_sampler_chain_add(chain, llama_sampler_init_greedy()) }
        else {
            llama_sampler_chain_add(chain, llama_sampler_init_top_k(Int32((m["topK"] as? Int) ?? 40)))
            llama_sampler_chain_add(chain, llama_sampler_init_top_p(Float((m["topP"] as? Double) ?? 0.95), 1))
            llama_sampler_chain_add(chain, llama_sampler_init_temp(Float(temp)))
            llama_sampler_chain_add(chain, llama_sampler_init_dist(UInt32.random(in: 0..<UInt32.max)))
        }
        var out = [UInt8](), sent = 0, used = prompt.count
        for _ in 0..<maxTokens {
            if isCancelled(cid) || used >= nCtx - 1 { break }
            var tok = llama_sampler_sample(chain, ctx, -1)
            if llama_vocab_is_eog(vocab, tok) { break }
            out += piece(vocab, tok)
            // stream only complete UTF-8 sequences
            var end = out.count
            while end > sent && end > out.count - 4 && String(bytes: out[sent..<end], encoding: .utf8) == nil { end -= 1 }
            if end > sent, let s = String(bytes: out[sent..<end], encoding: .utf8) { partial(["text": s]); sent = end }
            let rc = withUnsafeMutablePointer(to: &tok) { llama_decode(ctx, llama_batch_get_one($0, 1)) }
            used += 1
            if rc != 0 { break }
        }
        if sent < out.count { partial(["text": String(decoding: out[sent...], as: UTF8.self)]) }
        reply(true, ["text": String(decoding: out, as: UTF8.self)], nil)
    }

    private func embed(_ m: [String: Any], _ reply: Reply) {
        guard let cid = m["ctx"] as? Int, let c = contexts[cid], let model = models[c.model], let vocab = llama_model_get_vocab(model) else { reply(false, nil, "上下文不存在"); return }
        let ctx = c.ctx
        var toks = tokenize(vocab, (m["text"] as? String) ?? "", special: true)
        let limit = Int(llama_n_batch(ctx))
        if toks.count > limit { toks = Array(toks.prefix(limit)) }
        if toks.isEmpty { reply(true, ["vector": []], nil); return }
        llama_memory_clear(llama_get_memory(ctx), true)
        var batch = llama_batch_init(Int32(toks.count), 0, 1)
        defer { llama_batch_free(batch) }
        for (i, t) in toks.enumerated() {
            batch.token[i] = t; batch.pos[i] = Int32(i); batch.n_seq_id[i] = 1; batch.seq_id[i]![0] = 0; batch.logits[i] = 1
        }
        batch.n_tokens = Int32(toks.count)
        let rc = (llama_model_has_encoder(model) && !llama_model_has_decoder(model)) ? llama_encode(ctx, batch) : llama_decode(ctx, batch)
        if rc != 0 { reply(false, nil, "embedding 失败（\(rc)）"); return }
        let n = Int(llama_model_n_embd(model))
        var v = [Float](repeating: 0, count: n)
        if let p = llama_get_embeddings_seq(ctx, 0) { for k in 0..<n { v[k] = p[k] } }
        else { // no pooling: mean over the tokens
            for i in 0..<toks.count { if let p = llama_get_embeddings_ith(ctx, Int32(i)) { for k in 0..<n { v[k] += p[k] / Float(toks.count) } } }
        }
        let norm = sqrt(v.reduce(0) { $0 + $1 * $1 })
        if norm > 0 { for k in 0..<n { v[k] /= norm } }
        reply(true, ["vector": v.map { Double($0) }], nil)
    }
}
#else
/// Builds without llama.xcframework (the iOS Simulator test job: the release framework has no simulator slice).
final class LlamaBridge {
    static let shared = LlamaBridge()
    typealias Reply = (_ ok: Bool, _ result: Any?, _ error: String?) -> Void
    func handle(_ m: [String: Any], reply: @escaping Reply, partial: @escaping ([String: Any]) -> Void) {
        if (m["cmd"] as? String) == "llama.info" { reply(true, ["available": false, "gpu": false], nil) }
        else { reply(false, nil, "此版本未包含 llama.cpp") }
    }
}
#endif
