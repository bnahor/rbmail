import Foundation
import SwiftData

@Model
final class RubidiumCacheBlob {
    @Attribute(.unique) var key: String
    var payload: Data
    var updatedAt: Date

    init(key: String, payload: Data, updatedAt: Date = .now) {
        self.key = key
        self.payload = payload
        self.updatedAt = updatedAt
    }
}

@MainActor
final class RubidiumLocalCache {
    static let shared = RubidiumLocalCache()

    private let container: ModelContainer?

    private init() {
        do {
            let root = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appending(path: "Rubidium", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: root.path)
            let configuration = ModelConfiguration(url: root.appending(path: "mail-cache.store"))
            container = try ModelContainer(for: RubidiumCacheBlob.self, configurations: configuration)
            protectStoreFiles(in: root)
        } catch {
            container = nil
        }
    }

    func load<Value: Decodable>(_ type: Value.Type, key: String) -> Value? {
        guard let container else { return nil }
        let context = ModelContext(container)
        guard let record = try? context.fetch(FetchDescriptor<RubidiumCacheBlob>()).first(where: { $0.key == key }) else {
            return nil
        }
        return try? JSONDecoder().decode(type, from: record.payload)
    }

    func save<Value: Encodable>(_ value: Value, key: String) {
        guard let container, let payload = try? JSONEncoder().encode(value) else { return }
        let context = ModelContext(container)
        if let record = try? context.fetch(FetchDescriptor<RubidiumCacheBlob>()).first(where: { $0.key == key }) {
            record.payload = payload
            record.updatedAt = .now
        } else {
            context.insert(RubidiumCacheBlob(key: key, payload: payload))
        }
        try? context.save()
    }

    func clear() {
        guard let container else { return }
        let context = ModelContext(container)
        if let records = try? context.fetch(FetchDescriptor<RubidiumCacheBlob>()) {
            records.forEach(context.delete)
            try? context.save()
        }
    }

    func remove(key: String) {
        guard let container else { return }
        let context = ModelContext(container)
        if let record = try? context.fetch(FetchDescriptor<RubidiumCacheBlob>()).first(where: { $0.key == key }) {
            context.delete(record)
            try? context.save()
        }
    }

    private func protectStoreFiles(in directory: URL) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files {
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: file.path
            )
        }
    }
}
