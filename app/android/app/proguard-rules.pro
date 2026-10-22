# Razorpay (razorpay_flutter). The SDK loads classes by reflection and calls
# back into the activity through onPayment* methods and a JavaScript bridge.
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** { *; }
-optimizations !method/inlining/
-keepclasseswithmembers class * {
    public void onPayment*(...);
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn proguard.annotation.Keep
-dontwarn proguard.annotation.KeepClassMembers

# Crashlytics: readable stack traces in release.
-keepattributes SourceFile,LineNumberTable
