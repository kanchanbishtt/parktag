package me.parktag.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createAlertChannel()
        // Shared E-Tag images are temporary; nothing from a previous run survives.
        File(cacheDir, SHARE_DIR).deleteRecursively()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result -> handle(call, result) }
    }

    private fun createAlertChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            ALERT_CHANNEL,
            "Alerts",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = "Someone needs you at your vehicle" }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "setSecure" -> {
                if (call.argument<Boolean>("secure") == true) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
                result.success(null)
            }
            "openFile" -> {
                val file = cacheFile(call.argument<String>("path"))
                val mime = call.argument<String>("mime") ?: "application/octet-stream"
                if (file == null || !file.isFile) {
                    result.error("BAD_PATH", "File not found", null)
                    return
                }
                val view = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uriFor(file), mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                start(view, result)
            }
            "shareImage" -> {
                val bytes = call.argument<ByteArray>("bytes")
                val name = (call.argument<String>("name") ?: "parktag.png")
                    .replace(Regex("[^A-Za-z0-9._-]"), "_")
                if (bytes == null) {
                    result.error("BAD_ARGS", "No image", null)
                    return
                }
                val dir = File(cacheDir, SHARE_DIR).apply { mkdirs() }
                val file = File(dir, name).apply { writeBytes(bytes) }
                val send = Intent(Intent.ACTION_SEND)
                    .setType("image/png")
                    .putExtra(Intent.EXTRA_STREAM, uriFor(file))
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                start(Intent.createChooser(send, null), result)
            }
            "shareText" -> {
                val text = call.argument<String>("text")
                if (text.isNullOrEmpty()) {
                    result.error("BAD_ARGS", "No text", null)
                    return
                }
                val send = Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, text)
                start(Intent.createChooser(send, null), result)
            }
            "cacheDir" -> result.success(cacheDir.absolutePath)
            "wipeCache" -> {
                val sub = call.argument<String>("dir")
                if (sub == VAULT_DIR || sub == SHARE_DIR) File(cacheDir, sub).deleteRecursively()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    // Only files under cache/vault or cache/share may leave the app.
    private fun cacheFile(path: String?): File? {
        if (path == null) return null
        val file = File(path).canonicalFile
        val allowed = listOf(VAULT_DIR, SHARE_DIR).map { File(cacheDir, it).canonicalPath + File.separator }
        return if (allowed.any { file.path.startsWith(it) }) file else null
    }

    private fun uriFor(file: File) = FileProvider.getUriForFile(this, "$packageName.files", file)

    private fun start(intent: Intent, result: MethodChannel.Result) {
        try {
            startActivity(intent)
            result.success(true)
        } catch (e: ActivityNotFoundException) {
            result.error("NO_APP", "No app can open this", null)
        }
    }

    companion object {
        private const val CHANNEL = "parktag/platform"
        private const val ALERT_CHANNEL = "parktag_alerts"
        private const val VAULT_DIR = "vault"
        private const val SHARE_DIR = "share"
    }
}
