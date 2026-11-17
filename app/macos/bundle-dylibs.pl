#!/usr/bin/env perl
#
# Part of Canela, a live Markdown editor in Hilde.
#
# SPDX-FileCopyrightText: 2026 Heiko Zimmermann
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#
# Copies every shared library a binary loads from outside macOS (not below
# /usr/lib or /System) into a Frameworks directory, with the libraries they
# load in turn, and points every reference at the copy
# (@executable_path/../Frameworks/<name>).  Ends with a check: no reference
# outside macOS and the bundle is left; exit 1 when one is.
#
#     perl bundle-dylibs.pl <binary> <frameworks directory>
use strict;
use warnings;

my ($binary, $frameworks) = @ARGV;
die "usage: bundle-dylibs.pl BINARY FRAMEWORKS\n" unless defined $frameworks && -f $binary && -d $frameworks;

sub system_path { my ($p) = @_; return $p =~ m{^(/usr/lib/|/System/)}; }

# The libraries a file references, from otool -L, without its own id.
sub references {
    my ($file) = @_;
    open(my $fh, '-|', 'otool', '-L', $file) or die "otool: $!\n";
    my @lines = <$fh>;
    close($fh) or die "otool -L $file failed\n";
    shift @lines;
    my @refs;
    for my $line (@lines) {
        push @refs, $1 if $line =~ m{^\s+(\S.*?) \(compatibility};
    }
    return @refs;
}

sub run { system(@_) == 0 or die "failed: @_\n"; }

my %copied;
my @todo = ($binary);
while (my $file = shift @todo) {
    for my $ref (references($file)) {
        next if system_path($ref) || $ref =~ m{^\@executable_path/};
        my ($name) = $ref =~ m{([^/]+)$};
        my $target = "$frameworks/$name";
        if (!$copied{$name}) {
            die "missing library $ref\n" unless -f $ref;
            run('cp', '-L', $ref, $target);
            run('chmod', 'u+w', $target);
            run('install_name_tool', '-id', "\@executable_path/../Frameworks/$name", $target);
            $copied{$name} = 1;
            push @todo, $target;
        }
        run('install_name_tool', '-change', $ref, "\@executable_path/../Frameworks/$name", $file);
    }
}

my $left = 0;
for my $file ($binary, map { "$frameworks/$_" } sort keys %copied) {
    for my $ref (references($file)) {
        next if system_path($ref) || $ref =~ m{^\@executable_path/\.\./Frameworks/};
        print STDERR "outside the bundle: $file -> $ref\n";
        $left++;
    }
}
printf "bundled %d libraries, %d references outside macOS and the bundle\n", scalar(keys %copied), $left;
exit($left == 0 ? 0 : 1);
