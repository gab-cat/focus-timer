// Apple Intelligence bridge for Focus Timer.
//
// A long-lived child of the Bun process (src/bun/intelligence.ts). It reads one
// JSON request per line on stdin and writes one JSON response per line on
// stdout, and exits when stdin closes, so it never outlives the app.
//
//   → {"id":1,"type":"availability"}
//   ← {"id":1,"ok":true,"result":{"available":false,"reason":"appleIntelligenceNotEnabled"}}
//   → {"id":2,"type":"planSession","text":"…","nextMeetingAt":1760000000000}
//   ← {"id":2,"ok":true,"result":{"title":"…","minutes":45,"steps":["…"]}}
//
// Built with plain swiftc (scripts/build-ai-helper.ts). Command Line Tools
// ship without the @Generable macro plugin, so schemas are built at runtime
// with DynamicGenerationSchema. The deployment target is below macOS 26 and
// FoundationModels is weak-linked, so on older systems the helper still runs
// and answers "unsupportedOS".

import Foundation
import FoundationModels

// MARK: - Output

let outputLock = NSLock()

func send(_ object: [String: Any]) {
	guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
	data.append(0x0A)
	outputLock.lock()
	FileHandle.standardOutput.write(data)
	outputLock.unlock()
}

func reply(_ id: Int, _ result: [String: Any]) {
	send(["id": id, "ok": true, "result": result])
}

func fail(_ id: Int, _ error: String) {
	send(["id": id, "ok": false, "error": error])
}

// MARK: - Planner

@available(macOS 26.0, *)
final class Planner: @unchecked Sendable {
	static let shared = Planner()

	static let minMinutes = 10
	static let maxMinutes = 120
	static let maxSteps = 4

	static let instructions = """
		You turn a short note about upcoming work into a plan for one focused work session.
		title: what the session is about, at most 5 words, no punctuation at the end.
		minutes: a realistic length for this work, between 15 and 90.
		steps: 2 to 4 short sub-goals in the order to do them, each under 8 words, starting with a verb.
		Only use work the user mentioned. Never add reviews, documentation, testing or breaks they did not ask for.
		"""

	static let schema: GenerationSchema = {
		let root = DynamicGenerationSchema(
			name: "SessionPlan",
			properties: [
				.init(
					name: "title",
					description: "What the session is about, at most 5 words",
					schema: .init(type: String.self)
				),
				.init(
					name: "minutes",
					description: "Session length in minutes",
					schema: .init(type: Int.self, guides: [.range(minMinutes...maxMinutes)])
				),
				.init(
					name: "steps",
					description: "Sub-goals in the order to do them",
					schema: .init(
						arrayOf: .init(type: String.self),
						minimumElements: 1,
						maximumElements: maxSteps
					)
				),
			]
		)
		return try! GenerationSchema(root: root, dependencies: [])
	}()

	private let lock = NSLock()
	private var warm: LanguageModelSession?

	static var availability: String? {
		switch SystemLanguageModel.default.availability {
		case .available:
			return nil
		case .unavailable(.deviceNotEligible):
			return "deviceNotEligible"
		case .unavailable(.appleIntelligenceNotEnabled):
			return "appleIntelligenceNotEnabled"
		case .unavailable(.modelNotReady):
			return "modelNotReady"
		case .unavailable:
			return "unavailable"
		}
	}

	// Sessions keep a transcript, so each plan gets a fresh one. The next
	// one is created and prewarmed ahead of time so the model is loaded
	// before the user presses Return.
	func prewarm() {
		guard Self.availability == nil else { return }
		lock.lock()
		defer { lock.unlock() }
		if warm != nil { return }
		let session = LanguageModelSession(instructions: Self.instructions)
		session.prewarm()
		warm = session
	}

	private func takeSession() -> LanguageModelSession {
		lock.lock()
		defer { lock.unlock() }
		let session = warm ?? LanguageModelSession(instructions: Self.instructions)
		warm = nil
		return session
	}

	func plan(text: String, nextMeetingAt: Double?) async throws -> [String: Any] {
		let session = takeSession()
		defer { prewarm() }

		var prompt = "Work: \(text)"
		if let at = nextMeetingAt {
			let free = Int((at / 1000 - Date().timeIntervalSince1970) / 60)
			if free > 0 { prompt += "\nMinutes until the next meeting: \(free)" }
		}

		let response = try await session.respond(
			to: prompt,
			schema: Self.schema,
			options: GenerationOptions(temperature: 0.3)
		)
		let content = response.content

		let title = Self.cleanTitle(try content.value(String.self, forProperty: "title"))
		let minutes = Self.clampMinutes(try content.value(Int.self, forProperty: "minutes"))
		let steps = Self.cleanSteps(try content.value([String].self, forProperty: "steps"))

		return ["title": title.isEmpty ? "Focus session" : title, "minutes": minutes, "steps": steps]
	}

	static func clampMinutes(_ value: Int) -> Int {
		let clamped = min(maxMinutes, max(minMinutes, value))
		return min(maxMinutes, max(minMinutes, Int((Double(clamped) / 5).rounded()) * 5))
	}

	static func cleanTitle(_ raw: String) -> String {
		let words = tidy(raw).split(separator: " ").prefix(6)
		return String(words.joined(separator: " ").prefix(48))
	}

	static func cleanSteps(_ raw: [String]) -> [String] {
		var seen = Set<String>()
		var out: [String] = []
		for step in raw {
			let clean = String(tidy(step).prefix(72))
			guard !clean.isEmpty, seen.insert(clean.lowercased()).inserted else { continue }
			out.append(clean)
			if out.count == maxSteps { break }
		}
		return out
	}

	// Collapses whitespace and drops list markers and trailing punctuation.
	static func tidy(_ raw: String) -> String {
		var s = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
		while let first = s.first, "-•*0123456789.) ".contains(first) { s.removeFirst() }
		while let last = s.last, ".,;:!".contains(last) { s.removeLast() }
		return s
	}

	static func describe(_ error: Error) -> String {
		guard let error = error as? LanguageModelSession.GenerationError else {
			return "Couldn't make a plan. Try again."
		}
		switch error {
		case .guardrailViolation, .refusal:
			return "Apple Intelligence declined that one. Try rewording it."
		case .exceededContextWindowSize:
			return "That's too long to plan. Try a shorter note."
		case .unsupportedLanguageOrLocale:
			return "Apple Intelligence doesn't support this language yet."
		case .assetsUnavailable:
			return "The on-device model isn't ready yet. Try again shortly."
		case .rateLimited, .concurrentRequests:
			return "Apple Intelligence is busy. Try again in a moment."
		default:
			return "Couldn't make a plan. Try again."
		}
	}
}

// MARK: - Requests

struct Request: Decodable {
	let id: Int
	let type: String
	let text: String?
	let nextMeetingAt: Double?
}

func handle(_ request: Request) async {
	guard #available(macOS 26.0, *) else {
		switch request.type {
		case "availability":
			reply(request.id, ["available": false, "reason": "unsupportedOS"])
		default:
			fail(request.id, "Apple Intelligence needs macOS 26 or later.")
		}
		return
	}

	switch request.type {
	case "availability":
		if let reason = Planner.availability {
			reply(request.id, ["available": false, "reason": reason])
		} else {
			reply(request.id, ["available": true])
		}

	case "planSession":
		let text = (request.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty else {
			fail(request.id, "Describe what you're working on.")
			return
		}
		guard Planner.availability == nil else {
			fail(request.id, "Apple Intelligence isn't available right now.")
			return
		}
		do {
			reply(request.id, try await Planner.shared.plan(text: text, nextMeetingAt: request.nextMeetingAt))
		} catch {
			fail(request.id, Planner.describe(error))
		}

	default:
		fail(request.id, "Unknown request: \(request.type)")
	}
}

// MARK: - Main

if #available(macOS 26.0, *) {
	Planner.shared.prewarm()
}

let decoder = JSONDecoder()
do {
	for try await line in FileHandle.standardInput.bytes.lines {
		guard let data = line.data(using: .utf8),
		      let request = try? decoder.decode(Request.self, from: data)
		else { continue }
		Task { await handle(request) }
	}
} catch {}

// stdin closed: the app quit or dropped us.
exit(0)
